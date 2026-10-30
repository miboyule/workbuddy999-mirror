@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "BASE_URL=%WORKBUDDY_SETUP_BASE_URL%"
if not defined BASE_URL set "BASE_URL=https://www.workbuddy999.top"
set "SCRIPT=%TEMP%\workbuddy-setup-%RANDOM%.ps1"
echo 正在下载 workbuddy 配置工具...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ($env:BASE_URL+'/setup/workbuddy-setup.ps1') -OutFile $env:SCRIPT"
if errorlevel 1 (echo 下载失败，请检查网络或 WORKBUDDY_SETUP_BASE_URL & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"
powershell -NoProfile -Command "Remove-Item -LiteralPath $env:SCRIPT -ErrorAction SilentlyContinue"
pause
exit /b %EXITCODE%
