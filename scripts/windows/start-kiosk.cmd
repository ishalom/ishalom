@echo off
rem Opens the brief full-screen on the TV. Edit the browser path if needed.
set BRIEF_URL=http://localhost:8080
start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --kiosk --incognito --noerrdialogs --disable-session-crashed-bubble %BRIEF_URL%
