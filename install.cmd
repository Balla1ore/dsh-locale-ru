@echo off
rem One-click install of the Russian language pack into the DSH "desktop" profile.
rem ASCII only on purpose - cmd.exe would garble Cyrillic in a .cmd file; the
rem Russian text comes from Node, which prints it correctly.
rem Usage: install.cmd [ --profile <name> ] [ --home <DSH_HOME> ] [ --remove ]
setlocal
set "PACK=%~dp0dsh-locale-ru"
if not exist "%PACK%\tools\install.mjs" set "PACK=%~dp0"
set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
where "%NODE%" >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install DeepSeek Harness and run this file again,
  echo or run: node "%PACK%\tools\install.mjs"
  pause
  exit /b 1
)
"%NODE%" "%PACK%\tools\install.mjs" %*
echo.
pause
exit /b %ERRORLEVEL%
