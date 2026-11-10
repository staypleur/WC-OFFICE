param([string]$OfficeRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$taskName = 'WC Office - Local Server'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$script = Join-Path $OfficeRoot 'start-background.ps1'
$launcher = (Get-Content -LiteralPath $script -Raw).Replace('$PSScriptRoot', ("'" + $OfficeRoot.Replace("'", "''") + "'"))
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$launcher = $launcher.Replace('(Get-Command node -CommandType Application -ErrorAction Stop).Source', ("'" + $nodePath.Replace("'", "''") + "'"))
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launcher))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encoded) -WorkingDirectory $OfficeRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
