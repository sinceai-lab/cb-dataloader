@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0services.ps1" %*
