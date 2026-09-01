import json
import os
import sys
from datetime import date, timedelta

import pyodbc

# Read-only bridge for the Crew Bookings page. Separate script/DSN from
# hiretrack_stocktake_read.py on purpose - unrelated tables/queries, and this
# one needs cp1251 decoding (Cyrillic job titles, phase titles, crew names)
# which the stocktake queries happen not to need.

DSN = os.environ.get("CREW_ODBC_DSN", "HireTrack DSN")
QUERY_TIMEOUT = int(os.environ.get("CREW_ODBC_QUERY_TIMEOUT", "60"))
HORIZON_DAYS = int(os.environ.get("CREW_ODBC_HORIZON_DAYS", "60"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def display_name(surname, forename):
    # Фамилия Имя (surname first) - Name2.FullName itself stores "Forename
    # Surname" and can't be reordered in place, so every person-facing name
    # in this app is built from the separate SURNAME/FORENAME columns
    # instead of trusting FullName's own word order.
    surname = (surname or "").strip()
    forename = (forename or "").strip()
    return f"{surname} {forename}".strip()


def _candidate_jobs(cursor):
    # Shared by the list and per-job detail: every NewCrewing job whose
    # crewing window overlaps the next HORIZON_DAYS days.
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    cursor.execute(
        """
        SELECT JobNo, Job_Ref, Job_Title, Status, "Due Out", "Due Back", xCrewManager,
               Client, "Type", Venue
        FROM JOBS
        WHERE NewCrewing = TRUE
          AND Status IN (1, 2, 3, 4, 6)
          AND "Due Back" >= ?
        ORDER BY "Due Out" ASC
        """,
        today,
    )
    all_jobs = cursor.fetchall()
    return [j for j in all_jobs if j[4].date() <= horizon]


def read_crew_list(cursor):
    # Lightweight job list ONLY - JOBS/Crew_header/CrewActivities, deliberately
    # never CrewPositions/CrewShifts. Confirmed live (2026-08-31): neither
    # CrewPositions.xCrewRequest nor CrewShifts.xPosition has an index, and a
    # bulk "WHERE ... IN (...)" against either one falls off a cliff once the
    # candidate-id list gets past a couple hundred entries - 374 ids measured
    # at 39s, 82 ids (the single largest job in the dataset) at 0.45s. That's
    # not a proportional slowdown, it's a cliff, so the fix isn't a smaller
    # global query - it's not doing the global query at all. Position/shift
    # detail is fetched on demand, scoped to one job at a time, in
    # read_job_detail() below - triggered by the frontend when a job row is
    # actually expanded.
    jobs = _candidate_jobs(cursor)
    job_nos = [j.JobNo for j in jobs]

    cursor.execute("SELECT Defcon_idx, Defcon_text, SortOrder FROM defcon")
    defcon_rows = cursor.fetchall()
    defcon = {r.Defcon_idx: r.Defcon_text for r in defcon_rows}
    defcon_rank = {r.Defcon_idx: r.SortOrder for r in defcon_rows}

    headers_by_job = {}
    if job_nos:
        cursor.execute(
            f'SELECT Idx, XJob FROM Crew_header WHERE XJob IN ({",".join("?" * len(job_nos))})',
            job_nos,
        )
        for h in cursor.fetchall():
            headers_by_job.setdefault(h.XJob, []).append(h.Idx)

    all_header_ids = [hid for hs in headers_by_job.values() for hid in hs]

    # Just the date range per header (not positions/shifts) - cheap even in
    # bulk (confirmed live: 12063 rows across 82 headers in 0.7s), used only
    # to compute each job's activity-span bar while collapsed.
    activity_dates_by_header = {}
    if all_header_ids:
        cursor.execute(
            f"""
            SELECT xArea, ActivityDate
            FROM CrewActivities WHERE xArea IN ({",".join("?" * len(all_header_ids))})
            """,
            all_header_ids,
        )
        for a in cursor.fetchall():
            activity_dates_by_header.setdefault(a.xArea, []).append(a.ActivityDate)

    manager_ids = list({j.xCrewManager for j in jobs if j.xCrewManager})
    managers = {}
    if manager_ids:
        cursor.execute(
            f'SELECT NameCounter, SURNAME, FORENAME FROM Name2 WHERE NameCounter IN ({",".join("?" * len(manager_ids))})',
            manager_ids,
        )
        managers = {r.NameCounter: display_name(r.SURNAME, r.FORENAME) for r in cursor.fetchall()}

    client_ids = list({j[7] for j in jobs if j[7]})
    clients = {}
    if client_ids:
        cursor.execute(
            f'SELECT CompanyCounter, CompanyName FROM Company WHERE CompanyCounter IN ({",".join("?" * len(client_ids))})',
            client_ids,
        )
        clients = {r.CompanyCounter: (r.CompanyName or "").strip() for r in cursor.fetchall()}

    type_ids = list({j[8] for j in jobs if j[8]})
    job_types = {}
    if type_ids:
        cursor.execute(
            f'SELECT Type_idx, Type_Desc FROM jobtypes WHERE Type_idx IN ({",".join("?" * len(type_ids))})',
            type_ids,
        )
        job_types = {r.Type_idx: (r.Type_Desc or "").strip() for r in cursor.fetchall()}

    venue_ids = list({j[9] for j in jobs if j[9]})
    venues = {}
    if venue_ids:
        cursor.execute(
            f'SELECT IDX, VenueName FROM venue WHERE IDX IN ({",".join("?" * len(venue_ids))})',
            venue_ids,
        )
        venues = {r.IDX: (r.VenueName or "").strip() for r in cursor.fetchall()}

    cursor.execute(
        "SELECT SURNAME, FORENAME FROM Name2 WHERE CREW = TRUE AND (Archived IS NULL OR Archived = FALSE)"
    )
    crew_roster = sorted(
        {display_name(r.SURNAME, r.FORENAME) for r in cursor.fetchall() if (r.SURNAME or "").strip() or (r.FORENAME or "").strip()}
    )

    today = date.today()
    result_jobs = []
    for j in jobs:
        header_ids = headers_by_job.get(j.JobNo, [])
        all_dates = [d for hid in header_ids for d in activity_dates_by_header.get(hid, [])]
        # Skip jobs with no Crew_header at all, or headers with no
        # CrewActivities - both checks are free (already-fetched bulk
        # data), unlike checking for real CrewPositions (see this
        # function's docstring). Confirmed live (2026-08-31): jobs like
        # "Наследие - продажа" have NewCrewing=TRUE but zero Crew_header
        # rows - they're not crew jobs at all, just sale/admin records that
        # happen to match the base filter, and used to be silently dropped
        # by the old code's "if not phases: continue" - this restores that
        # without reintroducing the slow per-job query.
        if not header_ids or not all_dates:
            continue
        # Also skip jobs whose real crew schedule has already fully lapsed,
        # even though the candidate-job SQL only filtered on JOBS."Due
        # Back". Confirmed live (2026-08-31): "ТМ Основой 2025" (Р5562МСК)
        # has Due Back = 2027-07-16 (still "open" by that field alone), but
        # its actual CrewActivities max out at 2026-08-10 - every one of its
        # 5460 activity rows is already in the past, zero today-or-future.
        # HireTrack's own Due Back on a long-running job apparently isn't
        # reliably closed out once real work stops, so it can't be trusted
        # alone as "is there anything left to staff here".
        if max(all_dates) < today:
            continue
        activity_start = min(all_dates)
        activity_end = max(all_dates)
        result_jobs.append(
            {
                "id": (j[1] or "").strip(),
                "status": defcon.get(j[3], str(j[3])),
                "statusRank": defcon_rank.get(j[3], 0),
                "name": (j[2] or "").strip(),
                "start": j[4].date().isoformat(),
                "end": j[5].date().isoformat(),
                "activityStart": activity_start.isoformat(),
                "activityEnd": activity_end.isoformat(),
                "crewBoss": managers.get(j[6], "Unassigned"),
                "client": clients.get(j[7]) or "—",
                "jobType": job_types.get(j[8]) or "—",
                "venue": venues.get(j[9]) or "—",
                # Populated on demand by read_job_detail() when this job's
                # row is expanded in the UI - see this function's docstring.
                "phases": [],
            }
        )

    return {"jobs": result_jobs, "crewRoster": crew_roster}


def read_job_detail(cursor, job_ref):
    # Position/shift detail for exactly ONE job, scoped tightly enough
    # (one job's own headers/crew/positions) to stay fast against the
    # unindexed CrewPositions/CrewShifts columns - see read_crew_list's
    # docstring. Fetched on demand when a job row is expanded, and
    # re-fetched periodically while it stays expanded (kept fresh without
    # needing a page-wide manual refresh).
    if not job_ref:
        raise ValueError("crew-job-detail requires 'jobRef'")

    cursor.execute("SELECT JobNo FROM JOBS WHERE Job_Ref = ?", job_ref)
    job = cursor.fetchone()
    if not job:
        raise ValueError(f"No job with Job_Ref = {job_ref!r}")

    cursor.execute("SELECT Idx, Title FROM Crew_header WHERE XJob = ?", job.JobNo)
    headers = cursor.fetchall()
    header_ids = [h.Idx for h in headers]

    # Filters on Crew.Job_no rather than Header IN (...) - confirmed via
    # strings analysis of the HireTrack NX client binary (2026-09-01) that
    # Crew.Job_no has a real index ("jobidx" in db.sql) and is exactly what
    # the vendor's own client filters on for this same join; Header has no
    # such index.
    crew_by_header = {}
    cursor.execute('SELECT Idx, Header, "Type", "Notes" FROM Crew WHERE Job_no = ? ORDER BY Idx', job.JobNo)
    for c in cursor.fetchall():
        crew_by_header.setdefault(c.Header, []).append(c)

    all_crew_ids = [c.Idx for cs in crew_by_header.values() for c in cs]
    all_type_ids = list({c.Type for cs in crew_by_header.values() for c in cs if c.Type is not None})

    positions_by_crew = {}
    if all_crew_ids:
        cursor.execute(
            f"""
            SELECT IDX, xCrewRequest, xPerson, CAST(Status AS SMALLINT) AS Status, Description
            FROM CrewPositions WHERE xCrewRequest IN ({",".join("?" * len(all_crew_ids))})
            ORDER BY xCrewRequest, IDX
            """,
            all_crew_ids,
        )
        for p in cursor.fetchall():
            positions_by_crew.setdefault(p.xCrewRequest, []).append(p)

    all_position_ids = [p.IDX for ps in positions_by_crew.values() for p in ps]
    all_person_ids = list({p.xPerson for ps in positions_by_crew.values() for p in ps if p.xPerson})

    shifts_by_position = {}
    if all_position_ids:
        cursor.execute(
            f"""
            SELECT IDX, xActivity, xPosition, CAST(BookingState AS SMALLINT) AS BookingState,
                   CAST(Status AS SMALLINT) AS Status, "Notes"
            FROM CrewShifts WHERE xPosition IN ({",".join("?" * len(all_position_ids))})
            """,
            all_position_ids,
        )
        for s in cursor.fetchall():
            shifts_by_position.setdefault(s.xPosition, []).append(s)

    activities_by_header = {}
    if header_ids:
        cursor.execute(
            f"""
            SELECT IDX, xArea, ActivityDate, Description
            FROM CrewActivities WHERE xArea IN ({",".join("?" * len(header_ids))})
            ORDER BY xArea, ActivityDate
            """,
            header_ids,
        )
        for a in cursor.fetchall():
            activities_by_header.setdefault(a.xArea, []).append(a)

    names = {}
    if all_person_ids:
        cursor.execute(
            f'SELECT NameCounter, SURNAME, FORENAME FROM Name2 WHERE NameCounter IN ({",".join("?" * len(all_person_ids))})',
            all_person_ids,
        )
        names = {r.NameCounter: display_name(r.SURNAME, r.FORENAME) for r in cursor.fetchall()}

    crewtypes = {}
    if all_type_ids:
        cursor.execute(
            f'SELECT Crewindex, CrewText FROM CREWTYPE WHERE Crewindex IN ({",".join("?" * len(all_type_ids))})',
            all_type_ids,
        )
        crewtypes = {r.Crewindex: (r.CrewText or "").strip() for r in cursor.fetchall()}

    phases = []
    for h in headers:
        acts = activities_by_header.get(h.Idx, [])
        if not acts:
            continue
        dates = [a.ActivityDate for a in acts]
        p_start, p_end = min(dates), max(dates)
        span = (p_end - p_start).days + 1
        date_index = {a.ActivityDate: i for i, a in enumerate(acts)}
        act_date_by_id = {a.IDX: a.ActivityDate for a in acts}

        positions_out = []
        for c in crew_by_header.get(h.Idx, []):
            role_text = crewtypes.get(c.Type, f"Type {c.Type}")
            role_notes = (c.Notes or "").strip()
            for p in positions_by_crew.get(c.Idx, []):
                qty = [0] * span
                shift_ids = [None] * span
                shift_notes = [""] * span
                shift_statuses = [None] * span
                for s in shifts_by_position.get(p.IDX, []):
                    if s.BookingState == 2:  # cancelled
                        continue
                    d = act_date_by_id.get(s.xActivity)
                    if d and d in date_index:
                        idx = date_index[d]
                        qty[idx] = 1
                        shift_ids[idx] = s.IDX
                        shift_notes[idx] = (s.Notes or "").strip()
                        shift_statuses[idx] = s.Status
                assignee = names.get(p.xPerson) if p.xPerson else None
                position_status = {0: "Unprocessed", 2: "Pencilled", 3: "Booked"}.get(p.Status, "Unprocessed")
                positions_out.append(
                    {
                        "positionId": p.IDX,
                        "role": role_text,
                        "position": role_text,
                        "description": (p.Description or "").strip(),
                        "status": position_status,
                        "assignee": assignee,
                        "qtyPerDay": qty,
                        "crewId": c.Idx,
                        "roleNotes": role_notes,
                        "shiftIds": shift_ids,
                        "shiftNotes": shift_notes,
                        "shiftStatuses": shift_statuses,
                    }
                )
        if positions_out:
            phases.append(
                {
                    "name": h.Title or "Crew",
                    "start": p_start.isoformat(),
                    "end": p_end.isoformat(),
                    "positions": positions_out,
                }
            )

    return {"jobRef": job_ref, "phases": phases}


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
        if operation == "crew-data":
            result = read_crew_list(cursor)
        elif operation == "crew-job-detail":
            result = read_job_detail(cursor, request.get("jobRef"))
        else:
            raise ValueError(f"Unsupported crew read operation: {operation}")
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
