# HireTrack Service Tickets App

Current status:

- backend-first scaffold
- Prisma schema drafted
- Express CRUD skeleton in place
- repository seam in place
- `memory` store is default for fast development
- `prisma` store mode is prepared for DB-backed switch
- StockCheck history reads directly from HireTrack through the read-only 32-bit `pyodbc` DSN
- stock-take responses are cached for 30 seconds and concurrent reads share one ODBC query

Reference docs:

- [TICKETS_MVP_V1.md](/C:/Users/shpar/OneDrive/Документы/New%20project/Hiretrack/TICKETS_MVP_V1.md)
- [TICKETS_DATA_MODEL_V1.md](/C:/Users/shpar/OneDrive/Документы/New%20project/Hiretrack/TICKETS_DATA_MODEL_V1.md)
- [TICKETS_IMPLEMENTATION_PLAN_V1.md](/C:/Users/shpar/OneDrive/Документы/New%20project/Hiretrack/TICKETS_IMPLEMENTATION_PLAN_V1.md)

Next implementation targets:

1. create real migration and run backend in `prisma` store mode
2. add activity log persistence
3. add barcode scanner UI
4. add Bitrix adapter

## Windows production deployment

Production runs from the `master` branch as the `HireTrackStocktakes` Windows
service. The service is isolated from HireTrack NX under
`C:\Services\hiretrack_stocktakes` and listens on port `3001` by default.

Run PowerShell as Administrator on the server:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
Invoke-WebRequest -UseBasicParsing `
  https://raw.githubusercontent.com/shparenkov/hiretrack_stocktakes/master/deploy/windows/install-production.ps1 `
  -OutFile $env:TEMP\install-production.ps1
& $env:TEMP\install-production.ps1
```

The private HireTrack API configuration must be stored outside the repository
at `C:\Services\hiretrack.config.json`.

StockCheck history does not use QBE. The Windows service starts the bundled
Python bridge with the 32-bit `HireTrack DSN`; `pyodbc` must be installed for
that Python runtime. QBE configuration remains available only for legacy
equipment and repair endpoints.

The stock-check UI and API require a password. Store it as a single line in
`C:\Services\hiretrack-access-password.txt`; the file is read through the
`STOCKTAKE_ACCESS_PASSWORD_FILE` service environment variable. Restart the
service after changing the password. Existing browser sessions are invalidated
automatically.

Sessions last 30 days by default. Set `STOCKTAKE_SESSION_DAYS` in the service
environment to a value from `1` to `365` to override the duration.

To deploy a later `master` update:

```powershell
& C:\Services\hiretrack_stocktakes\deploy\windows\update-production.ps1
```
