@echo off
setlocal
set "ROOT=%~dp0"
set "APP_ID=kivrio"
set "PORT_START=8000"
set "PORT_END=8009"
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

call :is_port_busy %PORT_START%
if not errorlevel 1 (
  call :is_expected_app %PORT_START%
  if not errorlevel 1 (
    set "PORT=%PORT_START%"
    goto open_browser
  )
  call :find_free_port
  if errorlevel 1 (
    echo [ERREUR] Aucun port local disponible pour Kivrio entre %PORT_START% et %PORT_END%.
    exit /b 1
  )
  goto start_server
)

set "PORT=%PORT_START%"

:start_server
start "" "%PY%" "%ROOT%server\app.py" --host 127.0.0.1 --port %PORT%
for /L %%I in (1,1,%WAIT_SECONDS%) do (
  call :is_expected_app %PORT%
  if not errorlevel 1 goto open_browser
  timeout /t 1 /nobreak >nul
)
echo [ERREUR] Kivrio n'a pas demarre sur le port %PORT%.
exit /b 1

:open_browser
start "" "http://127.0.0.1:%PORT%/index.html?t=%RANDOM%"
exit /b 0

:is_port_busy
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul
exit /b %errorlevel%

:find_free_port
for /L %%P in (%PORT_START%,1,%PORT_END%) do (
  call :is_port_busy %%P
  if errorlevel 1 (
    set "PORT=%%P"
    exit /b 0
  )
)
exit /b 1

:is_expected_app
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $u = 'http://127.0.0.1:%~1/api/health'; $req = [System.Net.WebRequest]::Create($u); $req.Timeout = 300; $req.ReadWriteTimeout = 300; $res = $req.GetResponse(); $reader = [System.IO.StreamReader]::new($res.GetResponseStream()); $j = $reader.ReadToEnd() | ConvertFrom-Json; $reader.Close(); $res.Close(); if ($j.app -eq '%APP_ID%') { exit 0 } } catch { } exit 1" >nul 2>nul
exit /b %errorlevel%
