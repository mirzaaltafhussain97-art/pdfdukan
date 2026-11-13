@echo off
title PDFdukan local server
cd /d "%~dp0"
set NODE_EXE=C:\Users\ANM\.codex\tools\rea\node-v24.22.1-win-x64\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
echo Starting PDFdukan on http://localhost:3000 ...
echo Keep this window open while testing. Close it to stop the server.
start "" "http://localhost:3000/scanner.html"
"%NODE_EXE%" static-server.cjs
echo.
echo Server stopped. If you see an error above, Node.js is not installed: get it from https://nodejs.org
pause
