# HireTrack Service Tickets App

Current status:

- backend-first scaffold
- Prisma schema drafted
- Express CRUD skeleton in place
- repository seam in place
- `memory` store is default for fast development
- `prisma` store mode is prepared for DB-backed switch

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

The stock-check UI and API require a password. Store it as a single line in
`C:\Services\hiretrack-access-password.txt`; the file is read through the
`STOCKTAKE_ACCESS_PASSWORD_FILE` service environment variable. Restart the
service after changing the password. Existing browser sessions are invalidated
automatically.

To deploy a later `master` update:

```powershell
& C:\Services\hiretrack_stocktakes\deploy\windows\update-production.ps1
```
