@echo off
rem The local server the TV points at. Runs at logon and stays up.
cd /d "%~dp0..\.."
call npx tsx src\server\index.ts >> "%~dp0..\..\out\server.log" 2>&1
