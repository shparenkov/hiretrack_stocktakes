import json
import os
import sys
from datetime import date, timedelta

import pyodbc

# Read-only bridge for the Planning app (/planning/ - equipment occupancy,
# shortage dashboard, jobs Gantt). Separate script/DSN from
# hiretrack_crew_read.py/hiretrack_stocktake_read.py on purpose - unrelated
# tables/queries, own DSN env var (PLANNING_ODBC_DSN) so this can point at a
# test DB independently while validated, same reasoning as the crew bridge.
# cp1251 decoding needed - job titles/equipment names carry Cyrillic.

DSN = os.environ.get("PLANNING_ODBC_DSN", "HireTrack DSN")
QUERY_TIMEOUT = int(os.environ.get("PLANNING_ODBC_QUERY_TIMEOUT", "60"))
HORIZON_DAYS = int(os.environ.get("PLANNING_ODBC_HORIZON_DAYS", "60"))
# Jobs.Status values treated as "real" (not draft/cancelled) - same filter
# hiretrack_crew_read.py already validated live for this purpose.
REAL_JOB_STATUSES = (1, 2, 3, 4, 6)
# Whlevel is read for this warehouse/pool only - confirmed live (this
# session) that warehouse 1 = "Moscow" (IsDefault), StockPool 0 = the normal
# owned-stock pool (see hiretrack-booking-api.ts's FALLBACK_WAREHOUSE_ID
# comment for the same site convention).
STOCK_SITE = 1
STOCK_POOL = 0

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def serialize(value):
    if isinstance(value, (date,)):
        return value.isoformat()
    return value


def day_range(start, end):
    days = []
    d = start
    while d <= end:
        days.append(d)
        d += timedelta(days=1)
    return days


def read_equipment_occupancy(cursor):
    today = date.today()
    horizon_end = today + timedelta(days=HORIZON_DAYS)
    days = day_range(today, horizon_end)
    day_index = {d: i for i, d in enumerate(days)}

    # Narrow to real, still-relevant jobs FIRST (same "Due Back" >= today
    # heuristic hiretrack_crew_read.py already validated live for this
    # purpose) before touching Sort at all - confirmed live this session
    # that scanning the whole Sort table (INNER JOIN Eqlists/Jobs, filtering
    # by S.D1/D2 directly) times out well past 240s, presumably a full scan
    # over years of historical bookings with no usable index on D1/D2.
    # Jobs.Due Out/Due Back aren't perfectly kept in sync with an individual
    # Eqlist's own DateOut/DateBack (see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md),
    # so this is a coarse pre-filter only - the real per-day attribution
    # below still uses each Sort line's own D1/D2.
    cursor.execute(
        """
        SELECT "JobNo", "Job_Ref", "Job_Title"
        FROM "Jobs"
        WHERE "Status" IN (""" + ",".join("?" * len(REAL_JOB_STATUSES)) + """)
          AND "Due Back" >= ?
        """,
        *REAL_JOB_STATUSES,
        today,
    )
    job_rows = cursor.fetchall()
    job_by_no = {j.JobNo: {"jobRef": (j.Job_Ref or "").strip(), "jobTitle": (j.Job_Title or "").strip()} for j in job_rows}
    job_nos = list(job_by_no.keys())

    rows = []
    if job_nos:
        cursor.execute(
            f"""
            SELECT "Eql_no" AS EqlNo, "Job_no" AS JobNo
            FROM "Eqlists"
            WHERE "Job_no" IN ({",".join("?" * len(job_nos))})
            """,
            job_nos,
        )
        eqlist_rows = cursor.fetchall()
        eqlist_job = {e.EqlNo: e.JobNo for e in eqlist_rows}
        eqlist_nos = list(eqlist_job.keys())

        if eqlist_nos:
            cursor.execute(
                f"""
                SELECT "Type" AS TypeId, "Quant" AS Qty, "D1" AS D1, "D2" AS D2, "Eqlno" AS EqlNo
                FROM "Sort"
                WHERE "Eqlno" IN ({",".join("?" * len(eqlist_nos))})
                  AND "D1" <= ? AND "D2" >= ?
                """,
                *eqlist_nos,
                horizon_end,
                today,
            )
            for r in cursor.fetchall():
                job_no = eqlist_job.get(r.EqlNo)
                job_info = job_by_no.get(job_no, {"jobRef": "", "jobTitle": ""})
                rows.append(
                    {
                        "typeId": r.TypeId,
                        "qty": r.Qty,
                        "d1": r.D1,
                        "d2": r.D2,
                        "jobNo": job_no,
                        "jobRef": job_info["jobRef"],
                        "jobTitle": job_info["jobTitle"],
                    }
                )

    type_ids = sorted({r["typeId"] for r in rows if r["typeId"] is not None})
    wanted_types = set(type_ids)

    # Deliberately UNFILTERED (no "Type IN (...)" clause) - confirmed live
    # this session that NexusDB handles a large parameterized IN list
    # catastrophically badly (721 placeholders took ~270s here, vs ~0.02s
    # for a full unfiltered scan of this same small table). Hetype is only
    # ~7000 rows - same "just read the whole table" approach the equipment-
    # catalog-full operation already uses in hiretrack_stocktake_read.py -
    # so fetch everything and filter down to wanted_types in Python instead.
    hetype = {}
    cursor.execute(
        """
        SELECT H."Type" AS TypeId, H."Description" AS Name, C."Description" AS CategoryName
        FROM "Hetype" H
        LEFT JOIN "category" C ON C."Category" = H."Category"
        """
    )
    for r in cursor.fetchall():
        if r.TypeId in wanted_types:
            hetype[r.TypeId] = {
                "name": (r.Name or "").strip(),
                "categoryName": (r.CategoryName or "").strip(),
            }

    # Same reasoning - filter by site/pool only (cheap, two literal values)
    # and narrow to wanted_types in Python rather than a huge IN clause.
    site_owns = {}
    cursor.execute(
        """
        SELECT "Typeidx" AS TypeId, "SiteOwns" AS SiteOwns
        FROM "Whlevel"
        WHERE "xSite" = ? AND CAST("StockPool" AS SMALLINT) = ?
        """,
        STOCK_SITE,
        STOCK_POOL,
    )
    for r in cursor.fetchall():
        if r.TypeId in wanted_types:
            site_owns[r.TypeId] = r.SiteOwns

    day_totals_by_type = {t: [0] * len(days) for t in type_ids}
    lines = []
    for r in rows:
        raw_d1, raw_d2 = r["d1"], r["d2"]
        d1 = max(raw_d1.date() if hasattr(raw_d1, "date") else raw_d1, today)
        d2 = min(raw_d2.date() if hasattr(raw_d2, "date") else raw_d2, horizon_end)
        if d1 > d2:
            continue
        totals = day_totals_by_type.get(r["typeId"])
        if totals is not None:
            i0 = day_index[d1]
            i1 = day_index[d2]
            for i in range(i0, i1 + 1):
                totals[i] += r["qty"] or 0
        lines.append(
            {
                "typeId": r["typeId"],
                "jobId": r["jobNo"],
                "jobRef": r["jobRef"],
                "jobTitle": r["jobTitle"],
                "start": d1.isoformat(),
                "end": d2.isoformat(),
                "qty": r["qty"] or 0,
            }
        )

    types_out = []
    for t in type_ids:
        info = hetype.get(t, {"name": f"Type {t}", "categoryName": ""})
        types_out.append(
            {
                "typeId": t,
                "name": info["name"] or f"Type {t}",
                "categoryName": info["categoryName"],
                "siteOwns": site_owns.get(t),
                "dayTotals": day_totals_by_type[t],
            }
        )
    types_out.sort(key=lambda t: (t["categoryName"], t["name"]))

    return {
        "start": today.isoformat(),
        "end": horizon_end.isoformat(),
        "types": types_out,
        "lines": lines,
    }


def main():
    request = json.load(sys.stdin)
    operation = request.get("operation")

    connection = pyodbc.connect(
        f"DSN={DSN};Timeout={QUERY_TIMEOUT * 1000};",
        timeout=QUERY_TIMEOUT,
        autocommit=True,
    )
    connection.setdecoding(pyodbc.SQL_CHAR, encoding="cp1251")
    connection.setdecoding(pyodbc.SQL_WCHAR, encoding="cp1251")
    try:
        cursor = connection.cursor()
        if operation == "equipment-occupancy":
            result = read_equipment_occupancy(cursor)
        else:
            raise ValueError(f"Unsupported planning read operation: {operation}")
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
