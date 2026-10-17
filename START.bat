@echo off
title qeep revival
cd /d "%~dp0"
echo.
echo   Starting qeep revival...
echo   Your browser will open at http://localhost:8080
echo.
echo   Keep this window open while you play.
echo   Press Ctrl+C to stop the server.
echo.
start "" http://localhost:8080
node server.js
pause
