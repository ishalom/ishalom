@echo off
rem Renders out\brief.html. Called by Task Scheduler at 07:00, 12:00 and 18:00.
cd /d "%~dp0..\.."
call npx tsx src\cli\brief.ts %1 >> "%~dp0..\..\out\brief.log" 2>&1
