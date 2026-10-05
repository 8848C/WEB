@echo off
REM Wrapper so the .ps1 scripts run even when the PowerShell execution policy
REM is Restricted. Passes every argument straight through.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup.ps1" %*
exit /b %ERRORLEVEL%
