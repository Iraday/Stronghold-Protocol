@echo off
rem Stronghold Protocol - double-click to host the game in Docker on this PC for the local network (devices on the same
rem Wi-Fi / LAN). Docs: docs\DEPLOY.md section 3. The work is done by start-docker-lan.ps1: cmd.exe misreads lines of a
rem .bat with Chinese text under chcp 65001, so this file stays ASCII. Arguments are passed on:
rem   -Port 3001   another port      -Assets   download / resume the art again      -NoFirewall   no firewall rule
rem   -Stop        stop the server   (SP_NO_BROWSER=1: no browser window)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-docker-lan.ps1" %*
