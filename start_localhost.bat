@echo off
setlocal
cd /d "%~dp0"
py server\app.py --host 127.0.0.1 --port 8000
