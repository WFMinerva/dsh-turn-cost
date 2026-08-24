@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\turn-cost-installer-package\Install.ps1" -Mode RepairTools -PackageRoot "%~dp0..\turn-cost-installer-package"
if errorlevel 1 pause
