@echo off
rem Clockwork launcher. Double click this file to start Clockwork.
rem
rem It is a script, not a new program, so a managed workstation treats it like the npm commands it
rem already runs. It starts the local interface, which opens in your default browser. This window
rem is the server: keep it open while you work, and close it to stop Clockwork.

setlocal
title Clockwork
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found. Clockwork needs Node 20 or later.
  echo   Install it from https://nodejs.org, then double click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   First start on this machine: installing what Clockwork needs. This happens once.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   The installation failed. The messages above say why.
    echo.
    pause
    exit /b 1
  )
)

rem The workspace is only created when you say so (D21): a missing one is usually a moved one.
if not defined BLUEPRINT_WORKSPACE if not exist "..\clockwork-workspace\" (
  echo.
  echo   No clockwork-workspace folder next to this one.
  echo   If you moved or renamed it, answer N and put it back next to the clockwork folder.
  echo   If this is your first start, answer Y to create it.
  echo.
  choice /c YN /m "  Create it now"
  if errorlevel 2 exit /b 1
  call npm run init
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call npm run gui
if errorlevel 1 (
  echo.
  echo   Clockwork stopped with an error. The messages above say why.
  echo.
  pause
)
