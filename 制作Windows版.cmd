@echo off
chcp 65001 >nul
title Project Progress Kanban - Windows Setup
rem The execution policy applies only to this build process; system policy is unchanged.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
if errorlevel 1 echo Setup failed. Please keep this window open and copy the error message.
pause
