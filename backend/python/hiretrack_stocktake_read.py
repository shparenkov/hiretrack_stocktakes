import json
import os
import sys
from datetime import date, datetime

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

# "Open an existing job" lookup for the create-job page - job ref -> its
# Eqlists (each with its real DateOut/DateBack, since append_to_booking must
# match those exactly - see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md) and their
# current Sort lines (with Hetype names, since Sort only has Type IDs).
# Exact match (after trimming), not case-insensitive: NexusDB's UPPER()/LOWER()
# don't fold Cyrillic case, confirmed live, and Job_Ref is always copy-pasted
# verbatim from HireTrack NX's own display anyway (fixed case as generated).
JOB_LOOKUP_QUERY = """
    SELECT "JobNo", "Job_Ref", "Name"
    FROM "Jobs"
    WHERE "Job_Ref" = ?
"""

JOB_LOOKUP_EQLISTS_QUERY = """
    SELECT "Eql_no", "Eql_name", "DateOut", "DateBack", "Client_no", "Client_name"
    FROM "Eqlists"
    WHERE "Job_no" = ?
"""

JOB_LOOKUP_SORT_QUERY = """
    SELECT S."Type" AS EquipmentTypeId, H."Description" AS EquipmentName, S."Quant"
    FROM "Sort" S
    LEFT JOIN "Hetype" H ON H."Type" = S."Type"
    WHERE S."Eqlno" = ?
    ORDER BY S."SortOrder"
"""


def serialize(value):
    if isinstance(value, (datetime, date)):
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


def read_job_lookup(cursor, job_ref):
    if not job_ref or not str(job_ref).strip():
        raise ValueError("job-lookup requires a 'jobRef'")

    cursor.execute(JOB_LOOKUP_QUERY, str(job_ref).strip())
    job_row = cursor.fetchone()
    if not job_row:
        return None

    job_no = job_row[0]
    job = {"jobNo": job_no, "jobRef": job_row[1], "name": job_row[2]}

    cursor.execute(JOB_LOOKUP_EQLISTS_QUERY, job_no)
    eqlists = rows_as_dicts(cursor)
    for eqlist in eqlists:
        cursor.execute(JOB_LOOKUP_SORT_QUERY, eqlist["Eql_no"])
        eqlist["lines"] = rows_as_dicts(cursor)

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
