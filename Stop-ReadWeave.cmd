@echo off
setlocal

where pwsh.exe >nul 2>nul
if %errorlevel% equ 0 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\readweave\stop.ps1"
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\readweave\stop.ps1"
)

if %errorlevel% neq 0 pause
endlocal
