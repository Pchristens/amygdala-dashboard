<#
  amygdala-hero.ps1 — run an agent (e.g. Grok) as an Amygdala hero from a Windows machine, no WSL needed.
  It runs the agent normally in this window and reports only its status (running / stopped) to Amygdala over
  Tailscale, with a heartbeat every 30 s. No files or transcripts are sent.

  Usage:
    .\amygdala-hero.ps1 -Server http://100.x.y.z:8795 -Pass hfh_XXXX -Title "isle: my project" -Project my-project grok
    .\amygdala-hero.ps1 -Pass hfh_XXXX -Title "isle: my project" grok --model grok-4.7
  If PowerShell refuses to run it:  powershell -ExecutionPolicy Bypass -File .\amygdala-hero.ps1 ...
#>
param(
  [Parameter(Mandatory)][string]$Pass,
  [Parameter(Mandatory)][string]$Title,
  [string]$Project = (Split-Path -Leaf (Get-Location)),
  [string]$Tool = 'grok',
  [Parameter(Mandatory)][string]$Server,   # e.g. http://<village machine's Tailscale IP>:8795
  [Parameter(ValueFromRemainingArguments)][string[]]$Command
)
if (-not $Command -or $Command.Count -eq 0) { $Command = @('grok') }

function Send-Status([string]$Status) {
  $body = @{ os = 'windows'; status = $Status; title = $Title; project = $Project; tool = $Tool; host = $env:COMPUTERNAME } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Method Post -Uri "$Server/hero/report" -Headers @{ Authorization = "Bearer $Pass" } `
      -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null
  } catch { Write-Warning "Amygdala report failed: $($_.Exception.Message)" }
}

Send-Status 'running'
Write-Host "Amygdala: '$Title' is now a hero in the village (status only is shared)." -ForegroundColor DarkCyan

$heartbeat = Start-Job -ArgumentList $Server, $Pass, $Title, $Project, $Tool, $env:COMPUTERNAME -ScriptBlock {
  param($Server, $Pass, $Title, $Project, $Tool, $HostName)
  while ($true) {
    Start-Sleep -Seconds 30
    $body = @{ os = 'windows'; status = 'running'; title = $Title; project = $Project; tool = $Tool; host = $HostName } | ConvertTo-Json -Compress
    try { Invoke-RestMethod -Method Post -Uri "$Server/hero/report" -Headers @{ Authorization = "Bearer $Pass" } -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null } catch {}
  }
}

try {
  $exe = $Command[0]; $rest = @($Command | Select-Object -Skip 1)
  & $exe @rest
} finally {
  Stop-Job $heartbeat -ErrorAction SilentlyContinue
  Remove-Job $heartbeat -Force -ErrorAction SilentlyContinue
  Send-Status 'stopped'
  Write-Host "Amygdala: '$Title' has ended its labour." -ForegroundColor DarkCyan
}
