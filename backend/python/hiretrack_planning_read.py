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
# Per explicit user request (2026-08-12): the occupancy/shortage horizon was
# 60 days, but a week ahead is enough - also cuts how many jobs/Eqlists/Sort
# rows get pulled in at all (see find_active_jobs' horizon_end param), not
# just how many days are displayed.
HORIZON_DAYS = int(os.environ.get("PLANNING_ODBC_HORIZON_DAYS", "7"))
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


# defcon.Defcon_idx -> (Defcon_text, SortOrder) - confirmed live this session
# (2026-08-12): idx 1 = "Запрос" (SortOrder 1), idx 2 = "Бронь" (SortOrder 2),
# idx 3 = "Подтверждено" and idx 6 = "Подтвержден (внутренний)" both
# SortOrder 3, idx 4 = "В работе" SortOrder 4 - i.e. every REAL_JOB_STATUSES
# value from 3 upward is some flavor of "confirmed or further along". Bucket
# rank into exactly the 3 stages the user asked to filter by
# (Запрос/Бронь/Подтверждено-and-beyond), same grouping crew-bookings' own
# status dropdown already uses ("Подтверждено и выше" for its rank>=3 option).
def read_defcon(cursor):
    cursor.execute("SELECT Defcon_idx, Defcon_text, SortOrder FROM defcon")
    rows = cursor.fetchall()
    text_by_status = {r.Defcon_idx: (r.Defcon_text or "").strip() for r in rows}
    rank_by_status = {r.Defcon_idx: min(r.SortOrder, 3) for r in rows}
    return text_by_status, rank_by_status


def find_active_jobs(cursor, window_start, horizon_end=None):
    # Narrow to real, still-relevant jobs FIRST (same "Due Back" >= <date>
    # heuristic hiretrack_crew_read.py already validated live for this
    # purpose, generalized from "today" to any requested window_start so a
    # shifted date filter re-queries instead of just re-slicing stale data)
    # before touching Sort/Eqlists at all - confirmed live this session that
    # scanning the whole Sort table (INNER JOIN Eqlists/Jobs, filtering by
    # S.D1/D2 directly) times out well past 240s, presumably a full scan
    # over years of historical bookings with no usable index on D1/D2.
    # Jobs.Due Out/Due Back aren't perfectly kept in sync with an individual
    # Eqlist's own DateOut/DateBack (see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md),
    # so this is a coarse pre-filter only - callers needing exact per-day
    # attribution still use each Sort line's own D1/D2.
    #
    # horizon_end, when given, also caps "Due Out" - narrows which jobs get
    # pulled into the (potentially large) Eqlists/Sort IN-clause fetches
    # that follow, not just which days get displayed. Per explicit user
    # request: occupancy/shortages only need jobs starting within the
    # requested window, not every future job regardless of how far out it
    # starts. jobs-gantt calls this without horizon_end - it wants the full
    # future pipeline, not just the current window.
    params = list(REAL_JOB_STATUSES) + [window_start]
    horizon_clause = ""
    if horizon_end is not None:
        horizon_clause = ' AND "Due Out" <= ?'
        params.append(horizon_end)

    cursor.execute(
        """
        SELECT "JobNo", "Job_Ref", "Job_Title", "Due Out", "Due Back", "Status"
        FROM "Jobs"
        WHERE "Status" IN (""" + ",".join("?" * len(REAL_JOB_STATUSES)) + """)
          AND "Due Back" >= ?"""
        + horizon_clause,
        params,
    )
    job_rows = cursor.fetchall()
    text_by_status, rank_by_status = read_defcon(cursor)
    return {
        j.JobNo: {
            "jobRef": (j.Job_Ref or "").strip(),
            "jobTitle": (j.Job_Title or "").strip(),
            "dueOut": j[3],
            "dueBack": j[4],
            "status": text_by_status.get(j.Status, str(j.Status)),
            "statusRank": rank_by_status.get(j.Status, 0),
        }
        for j in job_rows
    }


def read_equipment_occupancy(cursor, window_start=None, window_days=None):
    # window_start/window_days let the caller request any date range (the
    # frontend's shared date-filter toolbar can shift left/right across all
    # three tabs) - defaults preserve the original "today, HORIZON_DAYS"
    # behavior when the caller doesn't ask for a specific window.
    start_date = window_start or date.today()
    span = window_days if window_days is not None else HORIZON_DAYS
    horizon_end = start_date + timedelta(days=span - 1 if span > 0 else 0)
    days = day_range(start_date, horizon_end)
    day_index = {d: i for i, d in enumerate(days)}

    # Jobs still relevant to THIS window - "Due Back >= start_date" (not
    # "today"), since a window shifted into the future shouldn't pull in
    # jobs that already finished before that window starts.
    job_by_no = find_active_jobs(cursor, start_date, horizon_end)
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
                start_date,
            )
            for r in cursor.fetchall():
                job_no = eqlist_job.get(r.EqlNo)
                job_info = job_by_no.get(job_no, {"jobRef": "", "jobTitle": "", "status": "", "statusRank": 0})
                rows.append(
                    {
                        "typeId": r.TypeId,
                        "qty": r.Qty,
                        "d1": r.D1,
                        "d2": r.D2,
                        "jobNo": job_no,
                        "jobRef": job_info["jobRef"],
                        "jobTitle": job_info["jobTitle"],
                        "jobStatus": job_info["status"],
                        "jobStatusRank": job_info["statusRank"],
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
        d1 = max(raw_d1.date() if hasattr(raw_d1, "date") else raw_d1, start_date)
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
                "jobStatus": r["jobStatus"],
                "jobStatusRank": r["jobStatusRank"],
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
        "start": start_date.isoformat(),
        "end": horizon_end.isoformat(),
        "types": types_out,
        "lines": lines,
    }


def read_jobs_gantt(cursor):
    today = date.today()

    job_by_no = find_active_jobs(cursor, today)
    job_nos = list(job_by_no.keys())

    eqlists_by_job = {}
    if job_nos:
        cursor.execute(
            f"""
            SELECT "Eql_no" AS EqlNo, "Job_no" AS JobNo, "Eql_name" AS EqlName,
                   "Eql_Title" AS EqlTitle, "DateOut" AS DateOut, "DateBack" AS DateBack
            FROM "Eqlists"
            WHERE "Job_no" IN ({",".join("?" * len(job_nos))})
            ORDER BY "DateOut"
            """,
            job_nos,
        )
        eqlist_rows = cursor.fetchall()
        eqlist_nos = [e.EqlNo for e in eqlist_rows]

        line_counts = {}
        if eqlist_nos:
            cursor.execute(
                f"""
                SELECT "Eqlno" AS EqlNo, COUNT(*) AS LineCount
                FROM "Sort"
                WHERE "Eqlno" IN ({",".join("?" * len(eqlist_nos))})
                GROUP BY "Eqlno"
                """,
                eqlist_nos,
            )
            line_counts = {r.EqlNo: r.LineCount for r in cursor.fetchall()}

        for e in eqlist_rows:
            eqlists_by_job.setdefault(e.JobNo, []).append(
                {
                    "eqlNo": e.EqlNo,
                    "eqlName": (e.EqlName or "").strip(),
                    "eqlTitle": (e.EqlTitle or "").strip(),
                    "dateOut": e.DateOut.date().isoformat() if hasattr(e.DateOut, "date") else serialize(e.DateOut),
                    "dateBack": e.DateBack.date().isoformat() if hasattr(e.DateBack, "date") else serialize(e.DateBack),
                    "lineCount": line_counts.get(e.EqlNo, 0),
                }
            )

    jobs_out = []
    for job_no, info in job_by_no.items():
        eqlists = eqlists_by_job.get(job_no, [])
        if not eqlists:
            continue
        jobs_out.append(
            {
                "jobId": job_no,
                "jobRef": info["jobRef"],
                "jobTitle": info["jobTitle"],
                "start": min(e["dateOut"] for e in eqlists),
                "end": max(e["dateBack"] for e in eqlists),
                "eqlists": sorted(eqlists, key=lambda e: e["dateOut"]),
            }
        )
    jobs_out.sort(key=lambda j: j["start"])

    return {"generatedAt": date.today().isoformat(), "jobs": jobs_out}


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
            raw_start = request.get("start")
            window_start = date.fromisoformat(raw_start) if raw_start else None
            window_days = request.get("days")
            result = read_equipment_occupancy(cursor, window_start, window_days)
        elif operation == "jobs-gantt":
            result = read_jobs_gantt(cursor)
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
