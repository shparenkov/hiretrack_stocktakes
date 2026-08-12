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

    # Every Sort line on a real job whose own [D1, D2] range overlaps the
    # horizon window - D1/D2 are plain per-line date columns copied from the
    # owning Eqlist at insert time (confirmed in DB_QUERY_REFERENCE.md), so
    # this doesn't need to re-derive dates from Eqlists at all.
    cursor.execute(
        """
        SELECT S."Type" AS TypeId, S."Quant" AS Qty, S."D1" AS D1, S."D2" AS D2,
               J."JobNo" AS JobNo, J."Job_Ref" AS JobRef, J."Job_Title" AS JobTitle
        FROM "Sort" S
        INNER JOIN "Eqlists" E ON E."Eql_no" = S."Eqlno"
        INNER JOIN "Jobs" J ON J."JobNo" = E."Job_no"
        WHERE J."Status" IN (""" + ",".join("?" * len(REAL_JOB_STATUSES)) + """)
          AND S."D1" <= ?
          AND S."D2" >= ?
        """,
        *REAL_JOB_STATUSES,
        horizon_end,
        today,
    )
    rows = cursor.fetchall()

    type_ids = sorted({r.TypeId for r in rows if r.TypeId is not None})

    hetype = {}
    if type_ids:
        cursor.execute(
            f"""
            SELECT H."Type" AS TypeId, H."Description" AS Name, C."Description" AS CategoryName
            FROM "Hetype" H
            LEFT JOIN "category" C ON C."Category" = H."Category"
            WHERE H."Type" IN ({",".join("?" * len(type_ids))})
            """,
            type_ids,
        )
        for r in cursor.fetchall():
            hetype[r.TypeId] = {
                "name": (r.Name or "").strip(),
                "categoryName": (r.CategoryName or "").strip(),
            }

    site_owns = {}
    if type_ids:
        cursor.execute(
            f"""
            SELECT "Typeidx" AS TypeId, "SiteOwns" AS SiteOwns
            FROM "Whlevel"
            WHERE "xSite" = ? AND CAST("StockPool" AS SMALLINT) = ?
              AND "Typeidx" IN ({",".join("?" * len(type_ids))})
            """,
            STOCK_SITE,
            STOCK_POOL,
            *type_ids,
        )
        for r in cursor.fetchall():
            site_owns[r.TypeId] = r.SiteOwns

    day_totals_by_type = {t: [0] * len(days) for t in type_ids}
    lines = []
    for r in rows:
        d1 = max(r.D1.date() if hasattr(r.D1, "date") else r.D1, today)
        d2 = min(r.D2.date() if hasattr(r.D2, "date") else r.D2, horizon_end)
        if d1 > d2:
            continue
        totals = day_totals_by_type.get(r.TypeId)
        if totals is not None:
            i0 = day_index[d1]
            i1 = day_index[d2]
            for i in range(i0, i1 + 1):
                totals[i] += r.Qty or 0
        lines.append(
            {
                "typeId": r.TypeId,
                "jobId": r.JobNo,
                "jobRef": (r.JobRef or "").strip(),
                "jobTitle": (r.JobTitle or "").strip(),
                "start": d1.isoformat(),
                "end": d2.isoformat(),
                "qty": r.Qty or 0,
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
