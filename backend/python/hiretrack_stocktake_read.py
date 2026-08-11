import json
import os
import sys
from datetime import date, datetime, time, timedelta

import pyodbc


DSN = os.environ.get("HIRETRACK_ODBC_DSN", "HireTrack DSN")
QUERY_TIMEOUT = int(os.environ.get("HIRETRACK_ODBC_QUERY_TIMEOUT", "60"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

STOCKTAKE_SESSIONS_QUERY = """
    SELECT TOP 2
        ST.IDX AS StockTakeId
    FROM StockTakes ST
    LEFT JOIN Warehouses W ON W.IDX = ST.xWarehouse
    WHERE COALESCE(W.WarehouseName, '') <> 'Sochi'
    ORDER BY ST.StartDate DESC, ST.IDX DESC
"""

STOCKTAKE_HISTORY_QUERY = """
    SELECT
        ST.IDX AS StockTakeId,
        ST.Title AS StockTakeTitle,
        ST.Active AS StockTakeActive,
        ST.StartDate,
        ST.InActiveDate,
        W.WarehouseName,
        H.Type AS EquipmentTypeId,
        H.Description AS EquipmentType,
        C.Category AS CategoryId,
        C.Description AS CategoryName,
        MC.McatId AS MasterCategoryId,
        MC.McDescription AS MasterCategoryName,
        I.ItemRef,
        I.Barcode,
        I.SerialNo AS SerialNumber,
        CAST(I.CommissionStatus AS SMALLINT) AS CommissionStatus,
        I.CurrentJob AS CurrentEqlistId,
        CE.Eql_Name AS CurrentEqlistName,
        J.JobNo AS CurrentJobNo,
        J.Job_Ref AS CurrentJobRef,
        J.Name AS CurrentClientName,
        D."SeenDate" AS SeenDate,
        D."ProcessedDate" AS ProcessedDate,
        D."ActionedDate" AS ActionedDate,
        D."ActionNotes" AS ActionNotes,
        D."ActionedNotes" AS ActionedNotes,
        CAST(BID.Reason AS SMALLINT) AS DisposalReason,
        BID.DisposalDate,
        BID.Notes AS DisposalNotes
    FROM StockTakeDetails D
    INNER JOIN StockTakes ST ON ST.IDX = D.xStockTake
    LEFT JOIN Warehouses W ON W.IDX = ST.xWarehouse
    LEFT JOIN Item I ON I.ItemRef = D.xItemID
    LEFT JOIN Hetype H ON H.Type = COALESCE(D.xTypeID, I.Type)
    LEFT JOIN Category C ON C.Category = H.Category
    LEFT JOIN MasterCat MC ON MC.McatId = C.MasterCat
    LEFT JOIN BatchItemDisposals BID ON BID.Idx = I.xBatchDisposal
    LEFT JOIN Eqlists CE ON CE.Eql_no = I.CurrentJob AND I.CurrentJob NOT IN (0, 1)
    LEFT JOIN Jobs J ON J.JobNo = CE.Job_no
    WHERE COALESCE(I.BarcodeType, 0) <> 1
        AND D.xStockTake IN ({session_placeholders})
    ORDER BY ST.StartDate DESC, ST.IDX DESC, H.Description, I.SerialNo
"""

# Equipment catalog (Hetype) read path. Deliberately excludes Hetype.xManufacturer
# and Hetype.MPN: in this HireTrack setup those fields record the supplier /
# where the item was purchased, not the equipment's actual brand/model.
# See EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md before changing this query.
#
# EquipmentType (TEquipmentType: etSimple/etCompositeKit/etAliasKit/
# etPricedAliasKit/etMarkup) and the Similars join (a curated ~48-category
# functional taxonomy - "vocal mic", "DI box", "crash cymbal", etc.) are for
# rider matching to prefer over raw text similarity. See the "Similars
# taxonomy + Composite/Alias kit awareness" section of the blueprint doc.
EQUIPMENT_CATALOG_BASE_QUERY = """
    SELECT
        H."Type" AS EquipmentTypeId,
        H."Description" AS EquipmentName,
        H."Shortcode" AS Shortcode,
        H."Comments" AS Comments,
        H."LongDescription" AS LongDescription,
        CAST(H."Class" AS SMALLINT) AS Class,
        CAST(H."Visibility" AS SMALLINT) AS Visibility,
        CAST(H."EquipmentType" AS SMALLINT) AS EquipmentType,
        H."xSimilar" AS SimilarGroupId,
        SIM."Name" AS SimilarGroupName,
        C."Category" AS CategoryId,
        C."Description" AS CategoryName
    FROM "Hetype" H
    LEFT JOIN "category" C ON C."Category" = H."Category"
    LEFT JOIN "Similars" SIM ON SIM."IDX" = H."xSimilar"
"""

EQUIPMENT_CATALOG_BY_IDS_QUERY = EQUIPMENT_CATALOG_BASE_QUERY + """
    WHERE H."Type" IN ({id_placeholders})
"""

# Optional/mandatory accessory relationships (e.g. Yamaha CL5 -> iPad,
# optional; a speaker -> its mounting hardware, optional). Required=TRUE
# rows are mandatory accessories. NOTE: this table isn't covered by
# Lookups_LOG, so a delta sync only re-fetches accessories for master types
# whose *own* Hetype row changed - editing only a `related` row without
# touching its master Hetype won't be picked up until a full resync. Known
# limitation, acceptable for now given how rarely these change.
EQUIPMENT_RELATED_QUERY = """
    SELECT
        R."Mastertype" AS MasterTypeId,
        R."Subtype" AS SubtypeId,
        H2."Description" AS SubtypeName,
        R."Quantity" AS Quantity,
        R."Required" AS Required
    FROM "related" R
    INNER JOIN "Hetype" H2 ON H2."Type" = R."Subtype"
"""

EQUIPMENT_RELATED_BY_MASTER_IDS_QUERY = EQUIPMENT_RELATED_QUERY + """
    WHERE R."Mastertype" IN ({id_placeholders})
"""

# Composite Kit "recipe" (what a Composite/Alias Hetype actually expands to).
# Confirmed live: Type 33 "Zildjian A Custom 14\" Hi-Hats" -> 1x Bottom(21) +
# 1x Top(22), matching the NX client's own "Composite Definition" tab. Same
# Lookups_LOG caveat as `related`: not covered by the change feed, so a delta
# sync only re-fetches this for master types whose own Hetype row changed.
EQUIPMENT_COMPOSIT_QUERY = """
    SELECT
        C."Mastertype" AS MasterTypeId,
        C."Componenttype" AS ComponentTypeId,
        H2."Description" AS ComponentName,
        C."Quantity" AS Quantity
    FROM "COMPOSIT" C
    INNER JOIN "Hetype" H2 ON H2."Type" = C."Componenttype"
"""

EQUIPMENT_COMPOSIT_BY_MASTER_IDS_QUERY = EQUIPMENT_COMPOSIT_QUERY + """
    WHERE C."Mastertype" IN ({id_placeholders})
"""

# Lookups_LOG is populated by trigger trHeType_LOG on every insert/update/delete
# of HeType (ActionID 0=insert, 1=update, 2=delete). This is the cheap, indexed
# change feed the catalog sync relies on so a 7000+ row full re-query never has
# to run on a normal refresh cycle.
EQUIPMENT_CATALOG_CHANGES_QUERY = """
    SELECT L."MasterID" AS EquipmentTypeId, L."ActionID" AS ActionId, L."EditDate" AS EditDate
    FROM "Lookups_LOG" L
    WHERE L."TableName" = 'HeType' AND L."EditDate" > ?
    ORDER BY L."EditDate"
"""

EQUIPMENT_CATALOG_WATERMARK_QUERY = """
    SELECT MAX(L."EditDate") AS SyncedAt
    FROM "Lookups_LOG" L
    WHERE L."TableName" = 'HeType'
"""

# Used only if Lookups_LOG somehow has no HeType rows yet (shouldn't happen in
# practice) so the first delta call still has a lower bound to compare against.
FALLBACK_WATERMARK = "1900-01-01 00:00:00"

# Company search for the "create-job" page's client picker - api_v2's
# initialise_new_booking needs a real hiretrack_client_id (Company.CompanyCounter),
# which must come from the user, not be guessed. Excludes archived/on-hold
# companies since those shouldn't be picked for a new booking.
COMPANY_SEARCH_QUERY = """
    SELECT TOP 20
        "CompanyCounter" AS CompanyId,
        "CompanyName",
        "Town"
    FROM "Company"
    WHERE UPPER("CompanyName") LIKE UPPER(?)
        AND COALESCE("Archived", FALSE) = FALSE
        AND COALESCE("Hold", FALSE) = FALSE
    ORDER BY "CompanyName"
"""

# Interactive job search for the "open existing job" flow - users type a
# name (client or job title), not the job number, so this searches
# Job_Title/Name/Job_Ref together and returns the job numbers to pick from.
# Plain LIKE, no case transformation attempted: UPPER()/LOWER() don't fold
# Cyrillic case in this NexusDB instance (confirmed live) - matches as-typed
# case only, same limitation as the exact-match lookup below.
JOB_SEARCH_QUERY = """
    SELECT TOP 20 "JobNo", "Job_Ref", "Job_Title", "Name"
    FROM "Jobs"
    WHERE "Job_Title" LIKE ? OR "Name" LIKE ? OR "Job_Ref" LIKE ?
    ORDER BY "JobNo" DESC
"""

# HireTrack's own "Jobs > Defaults" settings (NX client, confirmed live
# 2026-08-11: SiteID 1 has DefaultJobStartTime=14:00:00,
# DefaultJobEndTime=12:00:00, DefaultJobPeriod=2) - read live rather than
# hardcoded so an admin's later change in HireTrack NX is picked up without
# a redeploy. Site 1 matches FALLBACK_WAREHOUSE_ID already used elsewhere in
# this codebase.
JOB_DEFAULTS_QUERY = """
    SELECT "DefaultJobStartTime", "DefaultJobEndTime", "DefaultJobPeriod"
    FROM "Rules"
    WHERE "SiteID" = ?
"""

# Active, non-crew Users - for the Sales Person picker (Handler is
# auto-set only, no picker yet - see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md).
USERS_QUERY = """
    SELECT "UID", "UserName", "FirstName", "LastName"
    FROM "Users"
    WHERE "Active" = TRUE AND "IsCrew" = FALSE
    ORDER BY "UserName"
"""

# Existing contacts (Name2 people) previously linked to this client Company
# via any past job - CONTACTS has no "company's persistent address book"
# concept of its own, every job gets its own CONTACTS row even when it's
# really the same real person reused (confirmed live: the same Name2.Person
# id recurs across many CONTACTS rows with different xLink/job numbers) -
# so this dedupes by Person, keeping each one's most recent contact details.
CLIENT_CONTACTS_QUERY = """
    SELECT C."Person", N."FullName", N."Telephone", N."Mobile", N."EMAIL", MAX(C."ContactsCounter") AS LatestContactId
    FROM "CONTACTS" C
    LEFT JOIN "Name2" N ON N."NameCounter" = C."Person"
    WHERE C."Company" = ?
    GROUP BY C."Person", N."FullName", N."Telephone", N."Mobile", N."EMAIL"
    ORDER BY N."FullName"
"""

# Recently-created jobs, shown as cards on the "open existing job" search
# page before the user types anything. Jobs.CreatedDate is a real TIMESTAMP
# (confirmed live via cur.columns()), not a bare-string-bindable value - the
# cutoff is computed as a real datetime here, same reasoning as every other
# NexusDB timestamp bind in this codebase.
JOB_RECENT_QUERY = """
    SELECT TOP 20 "JobNo", "Job_Ref", "Job_Title", "Name", "CreatedDate"
    FROM "Jobs"
    WHERE "CreatedDate" >= ?
    ORDER BY "CreatedDate" DESC
"""

# "Open an existing job" lookup for the create-job page - job ref -> its
# Eqlists (each with its real DateOut/DateBack, since append_to_booking must
# match those exactly - see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md) and their
# current Sort lines (with Hetype names, since Sort only has Type IDs).
# Exact match (after trimming), not case-insensitive: NexusDB's UPPER()/LOWER()
# don't fold Cyrillic case, confirmed live, and Job_Ref is always copy-pasted
# verbatim from HireTrack NX's own display anyway (fixed case as generated).
JOB_LOOKUP_QUERY = """
    SELECT "JobNo", "Job_Ref", "Name", "Due Out", "Due Back"
    FROM "Jobs"
    WHERE "Job_Ref" = ?
"""

JOB_LOOKUP_EQLISTS_QUERY = """
    SELECT "Eql_no", "Eql_name", "Eql_Title", "DateOut", "DateBack", "Client_no", "Client_name"
    FROM "Eqlists"
    WHERE "Job_no" = ?
    ORDER BY "Eql_no"
"""

JOB_LOOKUP_SORT_QUERY = """
    SELECT S."Type" AS EquipmentTypeId, H."Description" AS EquipmentName, S."Quant",
        S."sectionID" AS SectionId, CAST(H."EquipmentType" AS SMALLINT) AS EquipmentType,
        S."Lineref" AS LineRefId, CAST(H."Class" AS SMALLINT) AS Class
    FROM "Sort" S
    LEFT JOIN "Hetype" H ON H."Type" = S."Type"
    WHERE S."Eqlno" = ?
    ORDER BY S."SortOrder"
"""

# Sections group an Eqlist's lines for display (Sort.sectionID -> EqSections.idx).
# Nested view: Section -> its lines -> (for Composite/Alias lines) their
# components, per the equipment_catalog COMPOSIT data already synced for the
# catalog cache - see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md.
JOB_LOOKUP_SECTIONS_QUERY = """
    SELECT "idx" AS SectionId, "SectionText", "sortOrder"
    FROM "EqSections"
    WHERE "xEqlno" = ?
    ORDER BY "sortOrder"
"""


def serialize(value):
    # datetime.time (e.g. Rules.DefaultJobStartTime/EndTime) isn't a date/
    # datetime subclass - without this branch json.dump chokes on it with
    # "Object of type time is not JSON serializable".
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def rows_as_dicts(cursor):
    columns = [column[0] for column in cursor.description]
    return [
        {column: serialize(value) for column, value in zip(columns, row)}
        for row in cursor.fetchall()
    ]


def read_stocktake_history(cursor):
    cursor.execute(STOCKTAKE_SESSIONS_QUERY)
    session_ids = [int(row[0]) for row in cursor.fetchall()]
    if not session_ids:
        return []

    query = STOCKTAKE_HISTORY_QUERY.format(
        session_placeholders=", ".join("?" for _ in session_ids)
    )
    cursor.execute(query, *session_ids)
    return rows_as_dicts(cursor)


def read_equipment_catalog_watermark(cursor):
    cursor.execute(EQUIPMENT_CATALOG_WATERMARK_QUERY)
    row = cursor.fetchone()
    watermark = row[0] if row else None
    return serialize(watermark) if watermark is not None else FALLBACK_WATERMARK


def read_equipment_catalog_full(cursor):
    # Watermark is taken from Lookups_LOG *before* running the (slow) full
    # join, so any change that lands mid-query is still picked up by the very
    # next delta call instead of being silently missed.
    watermark = read_equipment_catalog_watermark(cursor)
    cursor.execute(EQUIPMENT_CATALOG_BASE_QUERY)
    items = rows_as_dicts(cursor)

    cursor.execute(EQUIPMENT_RELATED_QUERY)
    accessories = rows_as_dicts(cursor)

    cursor.execute(EQUIPMENT_COMPOSIT_QUERY)
    components = rows_as_dicts(cursor)

    return {
        "items": items,
        "accessories": accessories,
        "components": components,
        "syncedAt": watermark,
    }


def read_equipment_catalog_changes(cursor, since):
    if not since:
        raise ValueError("equipment-catalog-changes requires a 'since' timestamp")

    since_dt = datetime.fromisoformat(str(since))
    cursor.execute(EQUIPMENT_CATALOG_CHANGES_QUERY, since_dt)
    changes = rows_as_dicts(cursor)
    if not changes:
        return {"updated": [], "accessories": [], "components": [], "deletedIds": [], "syncedAt": since}

    # Walk changes in EditDate order so the *last* action per Type wins, then
    # resolve inserts/updates to fresh rows and deletes to bare IDs.
    latest_edit_date = since
    last_action_by_id = {}
    for row in changes:
        type_id = row.get("EquipmentTypeId")
        if type_id is None:
            continue
        last_action_by_id[type_id] = row.get("ActionId")
        edit_date = row.get("EditDate")
        if edit_date and edit_date > latest_edit_date:
            latest_edit_date = edit_date

    updated_ids = sorted(
        type_id for type_id, action in last_action_by_id.items() if action in (0, 1)
    )
    deleted_ids = set(
        type_id for type_id, action in last_action_by_id.items() if action == 2
    )

    updated_items = []
    accessories = []
    components = []
    if updated_ids:
        query = EQUIPMENT_CATALOG_BY_IDS_QUERY.format(
            id_placeholders=", ".join("?" for _ in updated_ids)
        )
        cursor.execute(query, *updated_ids)
        updated_items = rows_as_dicts(cursor)
        returned_ids = {item["EquipmentTypeId"] for item in updated_items}
        # An ID whose last logged action was insert/update but that no longer
        # exists was deleted after that log row was written - treat as deleted.
        deleted_ids.update(set(updated_ids) - returned_ids)

        rel_query = EQUIPMENT_RELATED_BY_MASTER_IDS_QUERY.format(
            id_placeholders=", ".join("?" for _ in updated_ids)
        )
        cursor.execute(rel_query, *updated_ids)
        accessories = rows_as_dicts(cursor)

        comp_query = EQUIPMENT_COMPOSIT_BY_MASTER_IDS_QUERY.format(
            id_placeholders=", ".join("?" for _ in updated_ids)
        )
        cursor.execute(comp_query, *updated_ids)
        components = rows_as_dicts(cursor)

    return {
        "updated": updated_items,
        "accessories": accessories,
        "components": components,
        "deletedIds": sorted(deleted_ids),
        "syncedAt": latest_edit_date,
    }


def read_company_search(cursor, query_text):
    if not query_text or not str(query_text).strip():
        return []
    like_pattern = f"%{str(query_text).strip()}%"
    cursor.execute(COMPANY_SEARCH_QUERY, like_pattern)
    return rows_as_dicts(cursor)


def read_job_search(cursor, query_text):
    if not query_text or not str(query_text).strip():
        return []
    like_pattern = f"%{str(query_text).strip()}%"
    cursor.execute(JOB_SEARCH_QUERY, like_pattern, like_pattern, like_pattern)
    return rows_as_dicts(cursor)


def read_job_recent(cursor, params):
    days = params.get("days") or 7
    cutoff = datetime.now() - timedelta(days=int(days))
    cursor.execute(JOB_RECENT_QUERY, cutoff)
    return rows_as_dicts(cursor)


def read_job_defaults(cursor, params):
    site_id = params.get("siteId") or 1
    cursor.execute(JOB_DEFAULTS_QUERY, site_id)
    row = cursor.fetchone()
    if not row:
        return None
    return {"DefaultJobStartTime": row[0], "DefaultJobEndTime": row[1], "DefaultJobPeriod": row[2]}


def read_users_list(cursor):
    cursor.execute(USERS_QUERY)
    return rows_as_dicts(cursor)


def read_client_contacts(cursor, params):
    client_id = params.get("clientId")
    if not client_id:
        raise ValueError("client-contacts requires a 'clientId'")
    cursor.execute(CLIENT_CONTACTS_QUERY, int(client_id))
    return rows_as_dicts(cursor)


def read_job_lookup(cursor, job_ref):
    if not job_ref or not str(job_ref).strip():
        raise ValueError("job-lookup requires a 'jobRef'")

    cursor.execute(JOB_LOOKUP_QUERY, str(job_ref).strip())
    job_row = cursor.fetchone()
    if not job_row:
        return None

    job_no = job_row[0]
    job = {
        "jobNo": job_no,
        "jobRef": job_row[1],
        "name": job_row[2],
        # Jobs."Due Out"/"Due Back" - a job-level date range distinct from
        # (and not kept in sync with) any individual Eqlist's own DateOut/
        # DateBack. Confirmed live: CreateNewEqlist copies the FIRST Eqlist's
        # dates onto these when a job is first created, but never touches
        # them again for later Eqlists (a 27-Eqlist real job's Due Back still
        # matched only its first Eqlist's end date, weeks before the actual
        # last one). Used as the sensible starting point when creating a
        # further Eqlist on this job - see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md.
        "dueOut": serialize(job_row[3]),
        "dueBack": serialize(job_row[4]),
    }

    cursor.execute(JOB_LOOKUP_EQLISTS_QUERY, job_no)
    eqlists = rows_as_dicts(cursor)
    for eqlist in eqlists:
        cursor.execute(JOB_LOOKUP_SORT_QUERY, eqlist["Eql_no"])
        eqlist["lines"] = rows_as_dicts(cursor)
        cursor.execute(JOB_LOOKUP_SECTIONS_QUERY, eqlist["Eql_no"])
        eqlist["sections"] = rows_as_dicts(cursor)

    job["eqlists"] = eqlists
    return job


def main():
    request = json.load(sys.stdin)
    operation = request.get("operation")

    connection = pyodbc.connect(
        f"DSN={DSN};Timeout={QUERY_TIMEOUT * 1000};",
        timeout=QUERY_TIMEOUT,
        autocommit=True,
    )
    try:
        cursor = connection.cursor()
        if operation == "stocktake-history":
            result = read_stocktake_history(cursor)
        elif operation == "equipment-catalog-full":
            result = read_equipment_catalog_full(cursor)
        elif operation == "equipment-catalog-changes":
            result = read_equipment_catalog_changes(cursor, request.get("since"))
        elif operation == "company-search":
            result = read_company_search(cursor, request.get("query"))
        elif operation == "job-lookup":
            result = read_job_lookup(cursor, request.get("jobRef"))
        elif operation == "job-search":
            result = read_job_search(cursor, request.get("query"))
        elif operation == "job-recent":
            result = read_job_recent(cursor, request)
        elif operation == "job-defaults":
            result = read_job_defaults(cursor, request)
        elif operation == "users-list":
            result = read_users_list(cursor)
        elif operation == "client-contacts":
            result = read_client_contacts(cursor, request)
        else:
            raise ValueError(f"Unsupported HireTrack read operation: {operation}")
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
