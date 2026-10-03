#Requires -Version 5.1
<#
.SYNOPSIS
    Point the DeepSeek Harness shortcuts at the Russian launcher.

.DESCRIPTION
    The launcher (launch-dsh-ru.vbs) applies the prepared shell translation and
    then starts DeepSeek Harness. This script rewrites every shortcut that starts
    the application so that a shell update is repaired on the next start without
    any extra step. Each shortcut is backed up once, next to itself, as
    "<name>.lnk.before-locale-ru".

.PARAMETER VbsPath
    The launcher to point at. Defaults to the copy inside the desktop profile.

.PARAMETER Restore
    Put the original shortcuts back from their backups.

.EXAMPLE
    pwsh -File install-launcher.ps1
    pwsh -File install-launcher.ps1 -Restore
#>
[CmdletBinding()]
param(
    [string]$VbsPath,
    [string]$AppExe,
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'

if (-not $AppExe) {
    $AppExe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
}
if (-not $VbsPath) {
    $home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
    $VbsPath = Join-Path $home_ 'profiles\desktop\plugins\dsh-locale-ru\launch-dsh-ru.vbs'
}

if (-not $Restore -and -not (Test-Path -LiteralPath $VbsPath)) {
    throw "launcher not found: $VbsPath (run tools/install.mjs first)"
}

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

$roots = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:PUBLIC 'Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
) | Where-Object { Test-Path -LiteralPath $_ }

$shell = New-Object -ComObject WScript.Shell
$changed = @()
$restored = @()

foreach ($root in $roots) {
    foreach ($file in Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue) {
        $backup = "$($file.FullName).before-locale-ru"
        if ($Restore) {
            if (Test-Path -LiteralPath $backup) {
                Copy-Item -LiteralPath $backup -Destination $file.FullName -Force
                $restored += $file.FullName
            }
            continue
        }
        $shortcut = $shell.CreateShortcut($file.FullName)
        if ($shortcut.TargetPath -ne $AppExe) { continue }
        if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $file.FullName -Destination $backup -Force }
        $shortcut.TargetPath = $wscript
        $shortcut.Arguments = "`"$VbsPath`""
        $shortcut.IconLocation = "$AppExe,0"
        $shortcut.WorkingDirectory = Split-Path -Parent $AppExe
        $shortcut.Save()
        $changed += $file.FullName
    }
}

if ($Restore) {
    if ($restored.Count -eq 0) { Write-Host 'Резервных копий ярлыков не найдено — восстанавливать нечего.' }
    else { $restored | ForEach-Object { Write-Host "восстановлен: $_" } }
    return
}

if ($changed.Count -eq 0) {
    Write-Host "Ярлыков, запускающих $AppExe, не найдено."
    Write-Host "Создайте ярлык вручную: цель — $wscript, аргумент — `"$VbsPath`"."
    return
}
$changed | ForEach-Object { Write-Host "переведён на лаунчер: $_" }
Write-Host ''
Write-Host 'Готово: запуск через эти ярлыки сам применит перевод оболочки, если его сбросит обновление.'
