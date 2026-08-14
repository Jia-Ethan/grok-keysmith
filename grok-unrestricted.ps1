# grok-unrestricted.ps1 — Windows entry for grok-keysmith.py run
param(
    [switch]$Override,
    [string]$ContractPath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PromptParts
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$Prompt = ($PromptParts -join " ").Trim()
if (-not $Prompt) {
    Write-Error "usage: grok-unrestricted.ps1 [-Override] [-ContractPath FILE] <prompt>"
    exit 2
}

$Args = @("$Root\grok-keysmith.py", "run", "--mode", $(if ($Override) { "override" } else { "default" }), "--prompt", $Prompt)
if ($ContractPath) {
    $Args += @("--contract-path", $ContractPath)
}
& $Python @Args
exit $LASTEXITCODE
