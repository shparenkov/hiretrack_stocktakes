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


def read_crew_data(cursor):
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)

    # columns by position (some names have spaces, no attribute access):
    # 0 JobNo, 1 Job_Ref, 2 Job_Title, 3 Status, 4 Due Out, 5 Due Back,
    # 6 xCrewManager, 7 Client, 8 Type, 9 MainVenue
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
    jobs = [j for j in all_jobs if j[4].date() <= horizon][:40]
    job_nos = [j.JobNo for j in jobs]

    cursor.execute("SELECT Defcon_idx, Defcon_text, SortOrder FROM defcon")
    defcon_rows = cursor.fetchall()
    defcon = {r.Defcon_idx: r.Defcon_text for r in defcon_rows}
    defcon_rank = {r.Defcon_idx: r.SortOrder for r in defcon_rows}

    headers_by_job = {}
    if job_nos:
        cursor.execute(
            f'SELECT Idx, XJob, Title FROM Crew_header WHERE XJob IN ({",".join("?" * len(job_nos))})',
            job_nos,
        )
        for h in cursor.fetchall():
            headers_by_job.setdefault(h.XJob, []).append(h)

    all_header_ids = [h.Idx for hs in headers_by_job.values() for h in hs]

    # ORDER BY Idx so the resulting position order is deterministic - the
    # write bridge resolves the same "position index" the UI shows back to a
    # real CrewPositions.IDX using this exact ordering.
    crew_by_header = {}
    if all_header_ids:
        cursor.execute(
            f'SELECT Idx, Header, "Type" FROM Crew WHERE Header IN ({",".join("?" * len(all_header_ids))}) ORDER BY Idx',
            all_header_ids,
        )
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
            SELECT IDX, xActivity, xPosition, CAST(BookingState AS SMALLINT) AS BookingState
            FROM CrewShifts WHERE xPosition IN ({",".join("?" * len(all_position_ids))})
            """,
            all_position_ids,
        )
        for s in cursor.fetchall():
            shifts_by_position.setdefault(s.xPosition, []).append(s)

    all_activity_ids = list({s.xActivity for ss in shifts_by_position.values() for s in ss if s.xActivity})

    activities_by_header = {}
    activity_by_id = {}
    if all_header_ids:
        cursor.execute(
            f"""
            SELECT IDX, xArea, ActivityDate, Description
            FROM CrewActivities WHERE xArea IN ({",".join("?" * len(all_header_ids))})
            ORDER BY xArea, ActivityDate
            """,
            all_header_ids,
        )
        for a in cursor.fetchall():
            activities_by_header.setdefault(a.xArea, []).append(a)
            activity_by_id[a.IDX] = a

    names = {}
    if all_person_ids:
        cursor.execute(
            f'SELECT NameCounter, FullName FROM Name2 WHERE NameCounter IN ({",".join("?" * len(all_person_ids))})',
            all_person_ids,
        )
        names = {r.NameCounter: r.FullName for r in cursor.fetchall()}

    crewtypes = {}
    if all_type_ids:
        cursor.execute(
            f'SELECT Crewindex, CrewText FROM CREWTYPE WHERE Crewindex IN ({",".join("?" * len(all_type_ids))})',
            all_type_ids,
        )
        crewtypes = {r.Crewindex: (r.CrewText or "").strip() for r in cursor.fetchall()}

    manager_ids = list({j.xCrewManager for j in jobs if j.xCrewManager})
    managers = {}
    if manager_ids:
        cursor.execute(
            f'SELECT NameCounter, FullName FROM Name2 WHERE NameCounter IN ({",".join("?" * len(manager_ids))})',
            manager_ids,
        )
        managers = {r.NameCounter: r.FullName for r in cursor.fetchall()}

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
        "SELECT FullName FROM Name2 WHERE CREW = TRUE AND (Archived IS NULL OR Archived = FALSE) ORDER BY FullName"
    )
    crew_roster = sorted({(r.FullName or "").strip() for r in cursor.fetchall() if r.FullName and r.FullName.strip()})

    result_jobs = []
    for j in jobs:
        headers = headers_by_job.get(j.JobNo, [])
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
                for p in positions_by_crew.get(c.Idx, []):
                    qty = [0] * span
                    for s in shifts_by_position.get(p.IDX, []):
                        if s.BookingState == 2:  # cancelled
                            continue
                        d = act_date_by_id.get(s.xActivity)
                        if d and d in date_index:
                            qty[date_index[d]] = 1
                    assignee = names.get(p.xPerson) if p.xPerson else None
                    positions_out.append(
                        {
                            "role": role_text,
                            "position": role_text,
                            "description": (p.Description or "").strip(),
                            "status": "Processed" if assignee else "Unprocessed",
                            "assignee": assignee,
                            "qtyPerDay": qty,
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

        if not phases:
            continue

        result_jobs.append(
            {
                "id": (j[1] or "").strip(),
                "status": defcon.get(j[3], str(j[3])),
                "statusRank": defcon_rank.get(j[3], 0),
                "name": (j[2] or "").strip(),
                "start": j[4].date().isoformat(),
                "end": j[5].date().isoformat(),
                "crewBoss": managers.get(j[6], "Unassigned"),
                "client": clients.get(j[7]) or "—",
                "jobType": job_types.get(j[8]) or "—",
                "venue": venues.get(j[9]) or "—",
                "phases": phases,
            }
        )

    return {"jobs": result_jobs, "crewRoster": crew_roster}


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
            result = read_crew_data(cursor)
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
