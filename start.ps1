Set-Location -LiteralPath $PSScriptRoot
if (-not $env:CODEX_BIN) {
    $codexCommand = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($codexCommand) { $env:CODEX_BIN = $codexCommand.Source }
}
if (-not $env:GH_BIN) {
    $githubCommand = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($githubCommand) { $env:GH_BIN = $githubCommand.Source }
}
node server.mjs
