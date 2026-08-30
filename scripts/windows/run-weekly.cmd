@echo off
rem Proposes next week's home/office days and writes them to Google Calendar.
cd /d "%~dp0..\.."
call npx tsx src\cli\weekly.ts >> "%~dp0..\..\out\weekly.log" 2>&1
