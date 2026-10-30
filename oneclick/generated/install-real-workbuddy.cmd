@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Agent Setup

set "CONFIG_URL=http://127.0.0.1:8787/api/tasks/qXJbbfUzuiFKQzlyEOlrSSUn/config"
set "INSTALL_MODE=real"
set "ARCH=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "ARCH=%PROCESSOR_ARCHITEW6432%"

if /I "%ARCH%"=="ARM64" (
    set "BINARY_NAME=setup-windows-arm64.exe"
) else if /I "%ARCH%"=="AMD64" (
    set "BINARY_NAME=setup-windows-amd64.exe"
) else (
    echo [ERROR] Only 64-bit Windows is supported. Architecture: %ARCH%.
    exit /b 1
)

for /f "delims=" %%I in ('powershell.exe -NoLogo -NoProfile -NonInteractive -Command "([uri]$env:CONFIG_URL).GetLeftPart([System.UriPartial]::Authority)"') do set "SERVER_ROOT=%%I"
if not defined SERVER_ROOT goto :failed
set "NEWAPI_BINARY_URL=%SERVER_ROOT%/bin/%BINARY_NAME%"
set "NEWAPI_SETUP=%TEMP%\newapi-oneclick-%RANDOM%-%RANDOM%.exe"

echo Downloading installer for %ARCH%...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:NEWAPI_BINARY_URL -OutFile $env:NEWAPI_SETUP"
if errorlevel 1 goto :failed
if not exist "%NEWAPI_SETUP%" goto :failed

echo Starting setup...
if /I "%INSTALL_MODE%"=="real" (
    if /I "%SERVER_ROOT:~0,17%"=="http://127.0.0.1:" (
        echo REAL INSTALL: current user configuration will be backed up and updated.
        "%NEWAPI_SETUP%" --config-url "%CONFIG_URL%" --allow-local-real-install
    ) else (
        "%NEWAPI_SETUP%" --config-url "%CONFIG_URL%"
    )
) else (
    set "TEST_HOME=%TEMP%\newapi-oneclick-test-%RANDOM%-%RANDOM%"
    call :run_test
)
set "SETUP_RESULT=%ERRORLEVEL%"
del /q "%NEWAPI_SETUP%" >nul 2>&1
if not "%SETUP_RESULT%"=="0" (
    echo.
    echo [ERROR] Setup failed. Please capture this screen for support.
    pause
    exit /b %SETUP_RESULT%
)
echo.
if /I "%INSTALL_MODE%"=="real" (
    echo REAL INSTALL finished. Check the restart result above.
) else (
    echo SANDBOX TEST finished. Real WorkBuddy was not changed or restarted.
)
echo This window will close in 5 seconds.
timeout /t 5 /nobreak >nul
exit /b 0

:run_test
mkdir "%TEST_HOME%\.workbuddy" >nul 2>&1
echo SANDBOX HOME: %TEST_HOME%
"%NEWAPI_SETUP%" --config-url "%CONFIG_URL%" --home "%TEST_HOME%" --no-restart
exit /b %ERRORLEVEL%

:failed
echo [ERROR] Download failed. Check the network and try again.
if defined NEWAPI_SETUP del /q "%NEWAPI_SETUP%" >nul 2>&1
pause
exit /b 1
