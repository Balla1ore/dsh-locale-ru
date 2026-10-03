@echo off
rem Point the DeepSeek Harness shortcuts at the Russian launcher (or undo it).
rem ASCII only on purpose - cmd.exe would garble Cyrillic in a .cmd file; the
rem Russian messages come from PowerShell, which prints them correctly.
rem Usage: install-launcher.cmd [ -Restore ]
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-launcher.ps1" %*
echo.
pause
exit /b %ERRORLEVEL%
