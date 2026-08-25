@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0配置额度登录.ps1"
if errorlevel 1 pause
