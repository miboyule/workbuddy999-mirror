@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "BASE_URL=%WORKBUDDY_SETUP_BASE_URL%"
if not defined BASE_URL set "BASE_URL=https://www.workbuddy999.top"
set "SCRIPT=%TEMP%\codebuddy-setup-%RANDOM%.ps1"
set "REGION_ARG=-Region cn"
set /p "REGION=国内版直接回车；国际版输入 global: "
if /I "%REGION%"=="global" set "REGION_ARG=-Region global"
echo 正在下载 codebuddy 配置工具...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ($env:BASE_URL+'/setup/codebuddy-setup.ps1') -OutFile $env:SCRIPT"
if errorlevel 1 (echo 下载失败，请检查网络或 WORKBUDDY_SETUP_BASE_URL & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -CodeBuddy %REGION_ARG% %*
set "EXITCODE=%ERRORLEVEL%"
powershell -NoProfile -Command "Remove-Item -LiteralPath $env:SCRIPT -ErrorAction SilentlyContinue"
pause
exit /b %EXITCODE%
