@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-kivrio.ps1" -PackageDir "%~dp0"
exit /b %errorlevel%
