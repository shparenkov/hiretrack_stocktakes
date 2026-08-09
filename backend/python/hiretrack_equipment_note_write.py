import json
import os
import sys
from datetime import datetime

import pyodbc

# Writable bridge for the equipment-catalog-match feature. Deliberately a
# SEPARATE script/DSN from hiretrack_stocktake_read.py, whose DSN is
# documented as read-only - do not point HIRETRACK_WRITE_ODBC_DSN at the same
# DSN as HIRETRACK_ODBC_DSN.
#
# Writes go through HireTrack's own stored function CreateNewNote(...) plus a
# plain insert into notebookdetails - the same pattern HireTrack documents for
# its Zapier integration. This deliberately avoids EQLISTS/Sort in general
# (that table is entangled with pricing, discounts and invoicing, and every
# safe write path for it is a heavyweight stored procedure meant to be driven
# from HireTrack NX itself) - the one narrow exception is
# update-eqlist-dates, which only touches Eqlists.DateOut/DateBack (plain
# date columns, no pricing) to work around a confirmed api_v2 bug - see that
# function's own comment. See EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md before
# changing what this script writes to.

DSN = os.environ.get("HIRETRACK_WRITE_ODBC_DSN")
QUERY_TIMEOUT = int(os.environ.get("HIRETRACK_WRITE_ODBC_QUERY_TIMEOUT", "60"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def create_note(cursor, params):
    title = params.get("title")
    if not title:
        raise ValueError("create-note requires a 'title'")

    user = params.get("user")
    if user is None:
        cursor.execute("SELECT TOP 1 uid FROM users WHERE systemadmin = TRUE")
        row = cursor.fetchone()
        user = int(row[0]) if row and row[0] is not None else None
    if user is None:
        raise ValueError("create-note: no 'user' given and no systemadmin user found")

    site = params.get("site", 1)
    currency = params.get("currency", 0)
    price_scheme = params.get("priceScheme", 0)

    # NexusDB refuses to call a data-modifying function from inside a plain
    # SELECT ("Functions that modify data may not be called in this
    # context") - confirmed live against production. The ODBC CALL escape is
    # required instead, and NexusDB doesn't support the "{? = CALL ...}"
    # output-parameter form either (syntax error) - fetch the new id via
    # LASTAUTOINC afterward, same pattern HireTrack's own procedures use.
    cursor.execute(
        "{CALL CreateNewNote(?, ?, ?, ?, ?)}",
        title, user, site, currency, price_scheme,
    )
    cursor.execute("SELECT LASTAUTOINC FROM #dummy")
    row = cursor.fetchone()
    if not row or row[0] is None:
        raise ValueError("CreateNewNote did not return a note id")
    note_id = int(row[0])

    client_name = params.get("clientName")
    client_id = params.get("clientId")
    if client_name is not None or client_id is not None:
        cursor.execute(
            "UPDATE notebook SET client = ?, clientid = ? WHERE idx = ?",
            client_name, client_id, note_id,
        )

    return {"noteId": note_id}


def add_note_line(cursor, params):
    note_id = params.get("noteId")
    eqtype = params.get("eqtype")
    qty = params.get("qty")
    if note_id is None or eqtype is None or qty is None:
        raise ValueError("add-note-line requires 'noteId', 'eqtype' and 'qty'")

    cursor.execute("SELECT TOP 1 category, daily FROM hetype WHERE type = ?", eqtype)
    row = cursor.fetchone()
    category = row[0] if row else None
    default_daily_rate = float(row[1]) if row and row[1] is not None else 0.0

    # priceEach is optional: when the caller doesn't supply one, fall back to
    # the equipment's own Hetype.Daily rate, matching what HireTrack NX's own
    # client uses for a manually-added line (confirmed against a real line:
    # qty=1, price=2500 -> LinePrice=2500). Previously this defaulted to 0,
    # which left every auto-created line priced at zero.
    price_each = params.get("priceEach")
    if price_each is None:
        price_each = default_daily_rate
    price_each = float(price_each)
    line_price = qty * price_each

    cursor.execute(
        "INSERT INTO notebookdetails "
        "(xnote, qty, eqtype, listunitprice, agreedunitprice, lineprice, rectype, warehouse, xcategory) "
        "VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)",
        note_id, qty, eqtype, price_each, price_each, line_price, category,
    )

    return {"noteId": note_id, "eqtype": eqtype, "qty": qty, "priceEach": price_each}


def update_eqlist_dates(cursor, params):
    # Corrects a confirmed api_v2 bug: initialise_new_booking's
    # availability_datetime_from/to never reach CreateNewEqlist's
    # aStartDate/aEndDate params, so it always falls back to its own
    # past-date safety clamp (DateOut=now, DateBack=tomorrow 08:00) instead
    # of the requested range - which then makes every append_to_booking call
    # fail with ValidationResult 6 (bvrBookingDatesNEQListDates), since the
    # appended line's dates don't match the Eqlist's actual (wrong) header
    # dates. This sets exactly what CreateNewEqlist should have set given
    # correct params - two plain date columns, no pricing/Sort/invoicing
    # fields touched. See EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md.
    eqlist_id = params.get("eqlistId")
    date_from = params.get("dateFrom")
    date_to = params.get("dateTo")
    if eqlist_id is None or not date_from or not date_to:
        raise ValueError("update-eqlist-dates requires 'eqlistId', 'dateFrom' and 'dateTo'")

    # NexusDB/pyodbc quirk (documented in DB_QUERY_REFERENCE.md): binding a
    # bare date-literal string to a TIMESTAMP column fails ("Could not
    # convert variant of type (String) into type (Double)") - must bind a
    # real datetime object instead. Confirmed live.
    cursor.execute(
        'UPDATE "Eqlists" SET "DateOut" = ?, "DateBack" = ? WHERE "Eql_no" = ?',
        datetime.fromisoformat(str(date_from)), datetime.fromisoformat(str(date_to)), eqlist_id,
    )
    return {"eqlistId": eqlist_id, "dateFrom": date_from, "dateTo": date_to}


def main():
    if not DSN:
        raise ValueError("HIRETRACK_WRITE_ODBC_DSN is not configured")

    request = json.load(sys.stdin)
    operation = request.get("operation")

    connection = pyodbc.connect(
        f"DSN={DSN};Timeout={QUERY_TIMEOUT * 1000};",
        timeout=QUERY_TIMEOUT,
        autocommit=True,
    )
    try:
        cursor = connection.cursor()
        if operation == "create-note":
            result = create_note(cursor, request)
        elif operation == "add-note-line":
            result = add_note_line(cursor, request)
        elif operation == "update-eqlist-dates":
            result = update_eqlist_dates(cursor, request)
        else:
            raise ValueError(f"Unsupported HireTrack write operation: {operation}")
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
