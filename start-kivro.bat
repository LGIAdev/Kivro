@echo off
setlocal
set "ROOT=%~dp0"
set "PORT=8000"

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

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul && set "PORT=8001"

start "" %PY% "%ROOT%server\app.py" --host 127.0.0.1 --port %PORT%
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/index.html?t=%RANDOM%"
