<#
  Registers the four Windows tasks the brief needs.
  Run once, from an elevated PowerShell:

      powershell -ExecutionPolicy Bypass -File scripts\windows\install-tasks.ps1

  Remove them again with uninstall-tasks.ps1.
#>

$ErrorActionPreference = 'Stop'

$root    = (Resolve-Path "$PSScriptRoot\..\..").Path
$scripts = Join-Path $root 'scripts\windows'
$user    = "$env:USERDOMAIN\$env:USERNAME"

New-Item -ItemType Directory -Force -Path (Join-Path $root 'out') | Out-Null

function Register-BriefTask {
    param(
        [string]   $Name,
        [string]   $Command,
        [string]   $Arguments,
        [object[]] $Triggers,
        [string]   $Description
    )

    $action    = New-ScheduledTaskAction -Execute $Command -Argument $Arguments -WorkingDirectory $root
    $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
                                              -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
                                              -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers -Settings $settings `
                           -Principal $principal -Description $Description -Force | Out-Null
    Write-Host "registered $Name"
}

# 07:00 / 12:00 / 18:00 — the brief and its two refreshes.
Register-BriefTask -Name 'MorningBrief - Brief' `
    -Command 'cmd.exe' -Arguments "/c `"$scripts\run-brief.cmd`"" `
    -Triggers @(
        (New-ScheduledTaskTrigger -Daily -At 7am),
        (New-ScheduledTaskTrigger -Daily -At 12pm),
        (New-ScheduledTaskTrigger -Daily -At 6pm)
    ) `
    -Description 'Renders the Hebrew morning brief to out\brief.html.'

# Saturday 20:00 — next week's home and office days.
Register-BriefTask -Name 'MorningBrief - Weekly planning' `
    -Command 'cmd.exe' -Arguments "/c `"$scripts\run-weekly.cmd`"" `
    -Triggers @((New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At 8pm)) `
    -Description 'Proposes next week''s home days and writes them to Google Calendar.'

# The local server, up from logon.
Register-BriefTask -Name 'MorningBrief - Server' `
    -Command 'cmd.exe' -Arguments "/c `"$scripts\start-server.cmd`"" `
    -Triggers @((New-ScheduledTaskTrigger -AtLogOn -User $user)) `
    -Description 'Serves the brief on http://localhost:8080 for the TV.'

# The kiosk browser, a minute after logon so the server is listening.
$kioskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$kioskTrigger.Delay = 'PT1M'
Register-BriefTask -Name 'MorningBrief - Kiosk' `
    -Command 'cmd.exe' -Arguments "/c `"$scripts\start-kiosk.cmd`"" `
    -Triggers @($kioskTrigger) `
    -Description 'Opens the brief full-screen on the TV.'

Write-Host ''
Write-Host 'Done. Check them with: Get-ScheduledTask -TaskName "MorningBrief*"'
Write-Host 'Run one now with:      Start-ScheduledTask -TaskName "MorningBrief - Brief"'
