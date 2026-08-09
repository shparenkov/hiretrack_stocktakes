import json
import os
import sys

import pyodbc

# Writable bridge for the Crew Bookings page. Deliberately a SEPARATE
# script/DSN from hiretrack_crew_read.py, whose DSN may be read-only - do not
# point CREW_WRITE_ODBC_DSN at the same DSN as CREW_ODBC_DSN unless that DSN
# is actually writable (e.g. "Claude Test" while validating against TestDB).
#
# Minimal field-diff write, empirically confirmed by comparing an
# Unprocessed vs a manually-Processed CrewPositions row in HireTrack NX
# itself (see DB_QUERY_REFERENCE.md, personnel.crew_scheduling section):
#   CrewPositions: xPerson, Status=3 (ssBooked), OrderStatus=1,
#                  LowestShiftStatus=3
#   CrewShifts (all rows for that position): Status=3 (ssBooked)
# This assigns into an existing empty position row - it does not clone or
# create rows, matching how HireTrack NX's own client does a manual
# assignment.

DSN = os.environ.get("CREW_WRITE_ODBC_DSN")
QUERY_TIMEOUT = int(os.environ.get("CREW_WRITE_ODBC_QUERY_TIMEOUT", "60"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def assign_position(cursor, params):
    job_ref = params.get("jobRef")
    phase_title = params.get("phaseTitle")
    position_index = params.get("positionIndex")
    person_name = params.get("personName")
    if not job_ref or not phase_title or position_index is None or not person_name:
        raise ValueError("assign-position requires 'jobRef', 'phaseTitle', 'positionIndex' and 'personName'")
    position_index = int(position_index)

    cursor.execute("SELECT JobNo FROM JOBS WHERE Job_Ref = ?", job_ref)
    job = cursor.fetchone()
    if not job:
        raise ValueError(f"No job with Job_Ref = {job_ref!r}")

    cursor.execute("SELECT Idx FROM Crew_header WHERE XJob = ? AND Title = ?", job.JobNo, phase_title)
    header = cursor.fetchone()
    if not header:
        raise ValueError(f"No Crew_header with Title = {phase_title!r} under job {job_ref!r}")

    # Same ordering extract_real_data / hiretrack_crew_read use: Crew ordered
    # by Idx, then CrewPositions ordered by IDX within each Crew row - the
    # UI's "position index" is resolved back to a real CrewPositions.IDX
    # using this exact order.
    cursor.execute(
        """
        SELECT P.IDX, P.xPerson, CAST(P.Status AS SMALLINT) AS Status, C.Idx AS CrewIdx, C."Type" AS RoleType
        FROM Crew C
        INNER JOIN CrewPositions P ON P.xCrewRequest = C.Idx
        WHERE C.Header = ?
        ORDER BY C.Idx, P.IDX
        """,
        header.Idx,
    )
    positions = cursor.fetchall()
    if position_index >= len(positions):
        raise ValueError(f"position_index {position_index} out of range, phase only has {len(positions)} position(s)")
    target_position = positions[position_index].IDX

    # CREW=TRUE AND not archived - same filter the read bridge uses to build
    # the roster dropdown. Without it, an archived/inactive duplicate with
    # the same FullName as an active crew member can get picked instead
    # (confirmed live: "Oleg Bogdan" NameCounter 168, archived, matched
    # before the real active NameCounter 227 - HireTrack NX's own UI doesn't
    # render archived people in this view, so the position looked empty
    # even though xPerson was technically set).
    cursor.execute(
        "SELECT NameCounter, FullName FROM Name2 WHERE FullName = ? AND CREW = TRUE AND (Archived IS NULL OR Archived = FALSE)",
        person_name,
    )
    people = cursor.fetchall()
    if not people:
        raise ValueError(f"No active crew Name2 row with FullName = {person_name!r}")
    person = people[0]

    cursor.execute(
        "UPDATE CrewPositions SET xPerson = ?, Status = 3, OrderStatus = 1, LowestShiftStatus = 3 WHERE IDX = ?",
        person.NameCounter,
        target_position,
    )
    cursor.execute("UPDATE CrewShifts SET Status = 3 WHERE xPosition = ?", target_position)

    return {
        "jobRef": job_ref,
        "phaseTitle": phase_title,
        "positionIndex": position_index,
        "positionId": target_position,
        "assignee": person.FullName,
    }


def main():
    if not DSN:
        raise ValueError("CREW_WRITE_ODBC_DSN is not configured")

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
        if operation == "assign-position":
            result = assign_position(cursor, request)
        else:
            raise ValueError(f"Unsupported crew write operation: {operation}")
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
