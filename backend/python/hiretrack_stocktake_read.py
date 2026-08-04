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


def main():
    request = json.load(sys.stdin)
    if request.get("operation") != "stocktake-history":
        raise ValueError("Unsupported HireTrack read operation")

    connection = pyodbc.connect(
        f"DSN={DSN};Timeout={QUERY_TIMEOUT * 1000};",
        timeout=QUERY_TIMEOUT,
        autocommit=True,
    )
    try:
        result = read_stocktake_history(connection.cursor())
        json.dump({"ok": True, "result": result}, sys.stdout, ensure_ascii=False)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
