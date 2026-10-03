@echo off
rem Publish this pack to GitHub from your own terminal.
rem ASCII only on purpose - cmd.exe would garble Cyrillic in a .cmd file.
rem
rem Usage:
rem   publish-github.cmd https://github.com/<owner>/<repo>.git
rem
rem The repository must already exist and be empty. The first push opens the
rem Git Credential Manager sign-in window; nothing is stored by this script.
setlocal
set "GIT=C:\Program Files\Git\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

if "%~1"=="" (
  echo Usage: publish-github.cmd https://github.com/OWNER/REPO.git
  pause
  exit /b 2
)

pushd "%~dp0.."
"%GIT%" remote remove origin >nul 2>nul
"%GIT%" remote add origin %1 || goto :fail
"%GIT%" push -u origin main || goto :fail
"%GIT%" tag -f v1.0.0
"%GIT%" push -f origin v1.0.0 || goto :fail
popd

echo.
echo Pushed. Repository: %1
echo Now anyone can install it in DSH: sidebar Plugins - Add plugin - paste the repository address.
echo Optional release asset: create a release in the browser and attach release\dsh-locale-ru-1.0.0.zip
pause
exit /b 0

:fail
popd
echo.
echo Push failed. Most likely causes: the repository does not exist yet, it already
echo has commits, or the sign-in window was closed. Create an empty repository at
echo https://github.com/new and run this script again.
pause
exit /b 1
