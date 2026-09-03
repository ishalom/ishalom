$ErrorActionPreference = 'Stop'

Get-ScheduledTask -TaskName 'MorningBrief*' -ErrorAction SilentlyContinue | ForEach-Object {
    Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
    Write-Host "removed $($_.TaskName)"
}
