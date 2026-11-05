@echo off
cd /d %~dp0
if not exist node_modules call npm install
call npm run build
start "" http://localhost:8080
call npm start
