@echo off
echo Starting Chat Server...
start "Chat Server" cmd /k "npm run dev:server"
echo Starting Chat Web Interface...
start "Chat Web" cmd /k "npm run dev:web"
echo.
echo Application started! 
echo Access it at https://192.168.0.167:3000
echo.
pause
