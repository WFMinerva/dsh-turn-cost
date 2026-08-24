@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -Mode Install -PackageRoot "%~dp0"
if errorlevel 1 pause
