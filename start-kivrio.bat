@echo off
setlocal
set "ROOT=%~dp0"
set "PORT=8000"
set "EMBEDDED_PY=%ROOT%runtime\backend-python\python.exe"
set "WAIT_SECONDS=30"

if exist "%EMBEDDED_PY%" (
  set "PY=%EMBEDDED_PY%"
) else (
  where py >nul 2>nul
  if errorlevel 1 (
    where python >nul 2>nul
    if errorlevel 1 (
      echo [ERREUR] Python introuvable dans le PATH.
      pause
      exit /b 1
    )
    set "PY=python"
  ) else (
    set "PY=py"
  )
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul && set "PORT=8001"

start "" "%PY%" "%ROOT%server\app.py" --host 127.0.0.1 --port %PORT%
set "STATUS_URL=http://127.0.0.1:%PORT%/api/auth/status"
for /L %%I in (1,1,%WAIT_SECONDS%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%STATUS_URL%' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto open_browser
  timeout /t 1 /nobreak >nul
)

:open_browser
start "" "http://127.0.0.1:%PORT%/index.html?t=%RANDOM%"
