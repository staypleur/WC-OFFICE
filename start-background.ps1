$ErrorActionPreference = 'Stop'
try {
Set-Location -LiteralPath $PSScriptRoot
# Avoid starting a second server, including when launched manually.
if (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
$node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log')
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'startup-error.log')
  exit 1
}
