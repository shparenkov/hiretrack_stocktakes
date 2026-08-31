import json
import os
import sys

import pyodbc

# Writable bridge for the Crew Bookings page. Deliberately a SEPARATE
# script/DSN from hiretrack_crew_read.py, whose DSN may be read-only - do not
# point CREW_WRITE_ODBC_DSN at the same DSN as CREW_ODBC_DSN unless that DSN
# is actually writable (e.g. "Claude Test" while validating against TestDB).
#
# Two writes: CrewPositions/CrewShifts (TShiftStatus: 0 ssUnprocessed,
# 2 ssPencilled, 3 ssBooked) AND CrewPositionOffers (TCrewOfferStatus:
# 6 cosPencilled, 7 cosBooked, 8 cosCancelled - see db.sql's CREATE TABLE
# "CrewPositionOffers" and trCrewPositionOffersBEFORE). Both are required -
# HireTrack NX's position detail view reads CrewPositionOffers specifically,
# so writing only the flat CrewPositions/CrewShifts fields (the original,
# incomplete version of this script) makes a position look assigned in the
# grid while showing no real offer status once opened.
#
# Confirmed live (production CrewPositionOffers, 7000+ rows) that switching
# who's assigned to a position is done by cancelling the old active offer
# (OfferStatus -> 8) and INSERTing a fresh row for the new person, not
# updating the old row's xPerson in place - multiple historical rows per
# position (shortlisted/contacted/rejected candidates) is normal. The
# trigger also SIGNALs an error if you try to set a second row to
# OfferStatus=7 while another row for the same position is still 7, so any
# previously-booked offer must be cancelled first.
#
# Baseline "Unprocessed" field values (Status/OrderStatus/LowestShiftStatus)
# empirically confirmed against thousands of untouched xPerson IS NULL rows:
# (0, 0, 0).

DSN = os.environ.get("CREW_WRITE_ODBC_DSN")
QUERY_TIMEOUT = int(os.environ.get("CREW_WRITE_ODBC_QUERY_TIMEOUT", "60"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

# TShiftStatus (CrewPositions.Status / CrewShifts.Status)
SHIFT_STATUS_UNPROCESSED = 0
SHIFT_STATUS_PENCILLED = 2
SHIFT_STATUS_BOOKED = 3

# TCrewOfferStatus (CrewPositionOffers.OfferStatus)
OFFER_STATUS_PENCILLED = 6
OFFER_STATUS_BOOKED = 7
OFFER_STATUS_CANCELLED = 8


SHIFT_STATUS_LABELS = {0: "Unprocessed", 2: "Pencilled", 3: "Booked"}


def fetch_position_state(cursor, position_id):
    # Current on-the-wire status/assignee for a position, used both to
    # render results and to check for staleness before writing (see
    # check_not_stale below).
    cursor.execute("SELECT xPerson, CAST(Status AS SMALLINT) AS Status FROM CrewPositions WHERE IDX = ?", position_id)
    row = cursor.fetchone()
    if not row:
        raise ValueError(f"No CrewPositions row with IDX = {position_id!r}")
    status_label = SHIFT_STATUS_LABELS.get(row.Status, "Unprocessed")
    assignee = None
    if row.xPerson:
        cursor.execute("SELECT SURNAME, FORENAME FROM Name2 WHERE NameCounter = ?", row.xPerson)
        p = cursor.fetchone()
        if p:
            assignee = display_name(p.SURNAME, p.FORENAME)
    return status_label, assignee


def check_not_stale(cursor, position_id, expected_status, expected_assignee):
    # Optimistic-concurrency guard: the browser sends back the status/
    # assignee it last saw for this position. If HireTrack NX (or another
    # browser tab) changed it since then, block the write instead of
    # silently acting on stale assumptions - the frontend surfaces this as
    # "data is stale, refresh" rather than a generic failure. Both fields
    # are optional so older/other callers that don't send them skip the
    # check entirely.
    current_status, current_assignee = fetch_position_state(cursor, position_id)
    if expected_status is not None and current_status != expected_status:
        raise ValueError(
            f"CONFLICT: Позиция уже изменилась в HireTrack (сейчас: {current_status}, "
            f"на странице было: {expected_status}). Обновите страницу и повторите."
        )
    if expected_assignee is not None and (current_assignee or None) != (expected_assignee or None):
        raise ValueError(
            f"CONFLICT: Назначенный человек уже изменился в HireTrack (сейчас: {current_assignee or '—'}, "
            f"на странице было: {expected_assignee or '—'}). Обновите страницу и повторите."
        )
    return current_status, current_assignee


def display_name(surname, forename):
    # Фамилия Имя (surname first) - matches hiretrack_crew_read.py's own
    # display_name(), since the frontend sends back exactly what the roster
    # dropdown showed. Name2.FullName itself stores "Forename Surname" and
    # can't be reordered in place, so matching must use the same constructed
    # string the read bridge built, not the raw FullName column.
    surname = (surname or "").strip()
    forename = (forename or "").strip()
    return f"{surname} {forename}".strip()


def resolve_person(cursor, person_name):
    # CREW=TRUE AND not archived - same filter the read bridge uses to build
    # the roster dropdown. Without it, an archived/inactive duplicate with
    # the same name as an active crew member can get picked instead
    # (confirmed live: "Oleg Bogdan" NameCounter 168, archived, matched
    # before the real active NameCounter 227).
    #
    # Matches on the constructed Surname-first string in Python rather than
    # a SQL WHERE, both because FullName's own word order doesn't match it
    # and because a NexusDB quirk (confirmed live) raises "Type mismatch
    # (nxtShortString <> nxtBLOB)" when a parameterized string-equality
    # WHERE is combined with "(Archived IS NULL OR Archived = FALSE)" in the
    # same query - CREW=TRUE stays in SQL, everything else filters after.
    cursor.execute("SELECT NameCounter, SURNAME, FORENAME, Archived FROM Name2 WHERE CREW = TRUE")
    people = [p for p in cursor.fetchall() if not p.Archived and display_name(p.SURNAME, p.FORENAME) == person_name]
    if not people:
        raise ValueError(f"No active crew Name2 row with display name {person_name!r}")
    return people[0]


def assign_position(cursor, params):
    position_id = params.get("positionId")
    person_name = params.get("personName")
    offer_status_name = params.get("offerStatus", "booked")
    expected_status = params.get("expectedStatus")
    expected_assignee = params.get("expectedAssignee")
    if position_id is None or not person_name:
        raise ValueError("assign-position requires 'positionId' and 'personName'")
    if offer_status_name not in ("pencilled", "booked"):
        raise ValueError("assign-position 'offerStatus' must be 'pencilled' or 'booked'")
    target_position = int(position_id)

    check_not_stale(cursor, target_position, expected_status, expected_assignee)
    person = resolve_person(cursor, person_name)

    if offer_status_name == "booked":
        shift_status = SHIFT_STATUS_BOOKED
        offer_status = OFFER_STATUS_BOOKED
        order_status = 1
        # A second row for this position going to OfferStatus=7 while
        # another is still 7 makes trCrewPositionOffersBEFORE SIGNAL an
        # error ("Crew already booked for this position...") - cancel any
        # existing booked offer first, matching the real cancel-then-insert
        # pattern seen in production data.
        cursor.execute(
            "UPDATE CrewPositionOffers SET OfferStatus = ? WHERE xPosition = ? AND OfferStatus = ?",
            OFFER_STATUS_CANCELLED,
            target_position,
            OFFER_STATUS_BOOKED,
        )
    else:
        shift_status = SHIFT_STATUS_PENCILLED
        offer_status = OFFER_STATUS_PENCILLED
        order_status = 0

    cursor.execute(
        "INSERT INTO CrewPositionOffers (xPosition, xPerson, OfferStatus, OfferStatusDate) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        target_position,
        person.NameCounter,
        offer_status,
    )

    cursor.execute(
        "UPDATE CrewPositions SET xPerson = ?, Status = ?, OrderStatus = ?, LowestShiftStatus = ? WHERE IDX = ?",
        person.NameCounter,
        shift_status,
        order_status,
        shift_status,
        target_position,
    )
    cursor.execute("UPDATE CrewShifts SET Status = ? WHERE xPosition = ?", shift_status, target_position)

    return {
        "positionId": target_position,
        "assignee": display_name(person.SURNAME, person.FORENAME),
        "offerStatus": offer_status_name,
    }


def unassign_position(cursor, params):
    position_id = params.get("positionId")
    expected_status = params.get("expectedStatus")
    expected_assignee = params.get("expectedAssignee")
    if position_id is None:
        raise ValueError("unassign-position requires 'positionId'")
    target_position = int(position_id)

    check_not_stale(cursor, target_position, expected_status, expected_assignee)

    cursor.execute(
        "UPDATE CrewPositionOffers SET OfferStatus = ? WHERE xPosition = ? AND (OfferStatus = ? OR OfferStatus = ?)",
        OFFER_STATUS_CANCELLED,
        target_position,
        OFFER_STATUS_PENCILLED,
        OFFER_STATUS_BOOKED,
    )
    cursor.execute(
        "UPDATE CrewPositions SET xPerson = NULL, Status = ?, OrderStatus = 0, LowestShiftStatus = ? WHERE IDX = ?",
        SHIFT_STATUS_UNPROCESSED,
        SHIFT_STATUS_UNPROCESSED,
        target_position,
    )
    cursor.execute("UPDATE CrewShifts SET Status = ? WHERE xPosition = ?", SHIFT_STATUS_UNPROCESSED, target_position)

    return {"positionId": target_position}


def sync_shifts(cursor, params):
    # A shift added to a position AFTER it was already Pencilled/Booked
    # starts at Status=0 (ssUnprocessed, "Not Allocated" in HT's own UI) -
    # the original assign_position() write only touched the shifts that
    # existed at assignment time. This re-applies the position's current
    # Status to any of its shifts still stuck at 0, i.e. "allocate the
    # already-assigned person onto the newly added shifts too".
    position_id = params.get("positionId")
    expected_status = params.get("expectedStatus")
    expected_assignee = params.get("expectedAssignee")
    if position_id is None:
        raise ValueError("sync-shifts requires 'positionId'")
    target_position = int(position_id)

    current_status, _ = check_not_stale(cursor, target_position, expected_status, expected_assignee)
    if current_status not in ("Pencilled", "Booked"):
        raise ValueError("Position has no active Pencilled/Booked assignment to sync new shifts to")
    position_status = SHIFT_STATUS_BOOKED if current_status == "Booked" else SHIFT_STATUS_PENCILLED

    cursor.execute(
        "UPDATE CrewShifts SET Status = ? WHERE xPosition = ? AND Status = ?",
        position_status,
        target_position,
        SHIFT_STATUS_UNPROCESSED,
    )

    return {
        "positionId": target_position,
        "status": "booked" if position_status == SHIFT_STATUS_BOOKED else "pencilled",
    }


def set_role_note(cursor, params):
    # Role.Notes lives on the Crew row (one level above CrewPositions) - a
    # crewId shared by several CrewPositions slots (e.g. all 3 of a "3x
    # Rigger" request) all read/write the same note.
    crew_id = params.get("crewId")
    notes = params.get("notes", "")
    if crew_id is None:
        raise ValueError("set-role-note requires 'crewId'")
    crew_id = int(crew_id)
    cursor.execute("UPDATE Crew SET Notes = ? WHERE Idx = ?", notes, crew_id)
    return {"crewId": crew_id, "notes": notes}


def set_shift_note(cursor, params):
    # Shift.Notes lives on CrewShifts, one row per day a position is booked.
    shift_id = params.get("shiftId")
    notes = params.get("notes", "")
    if shift_id is None:
        raise ValueError("set-shift-note requires 'shiftId'")
    shift_id = int(shift_id)
    cursor.execute("UPDATE CrewShifts SET Notes = ? WHERE IDX = ?", notes, shift_id)
    return {"shiftId": shift_id, "notes": notes}


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
        elif operation == "unassign-position":
            result = unassign_position(cursor, request)
        elif operation == "sync-shifts":
            result = sync_shifts(cursor, request)
        elif operation == "set-role-note":
            result = set_role_note(cursor, request)
        elif operation == "set-shift-note":
            result = set_shift_note(cursor, request)
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
