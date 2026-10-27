param([string]$Command = 'open', [string]$Name, [string]$Label = '', [double]$Hours = 24)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$StateDir = Join-Path $env:LOCALAPPDATA 'Amygdala'
New-Item -ItemType Directory -Force $StateDir | Out-Null
$Log = Join-Path $StateDir 'amygdala.log'
$PidFile = Join-Path $StateDir 'amygdala.pid'
$Port = if ($env:HEARTHFIELD_PORT) { $env:HEARTHFIELD_PORT } else { '8790' }
$Base = "http://127.0.0.1:$Port"
function Get-PageToken {
  $Page = Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 3
  if ($Page.Content -match '<meta name="hf-token" content="([^"]+)">') { return $Matches[1] }
  throw 'Amygdala did not return a page token.'
}
function Get-OwnedProcess {
  if (!(Test-Path $PidFile)) { return $null }
  $Record = Get-Content $PidFile -Raw | ConvertFrom-Json
  $Proc = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.pid)"
  if ($Proc -and $Proc.Name -eq 'node.exe' -and $Proc.CommandLine.Contains((Join-Path $Repo 'server.js')) -and $Proc.CreationDate.ToUniversalTime().Ticks.ToString() -eq $Record.created) { return $Proc }
  return $null
}
function Start-Amygdala {
  try { $null = Get-PageToken; return } catch {}
  if (Get-OwnedProcess) { throw 'Owned server is running but not responding; inspect amygdala logs.' }
  $Node = (Get-Command node.exe -ErrorAction Stop).Source
  $Server = Join-Path $Repo 'server.js'
  # Node opens one append-only log for both streams, avoiding PowerShell's separate redirect files.
  $Launch = @'
const fs = require('node:fs'), cp = require('node:child_process');
const fd = fs.openSync(process.argv[2], 'a');
const child = cp.spawn(process.execPath, [process.argv[1]], { cwd: process.argv[3], detached: true, windowsHide: true, shell: false, stdio: ['ignore', fd, fd] });
child.on('error', () => process.exit(1));
child.on('spawn', () => { console.log(child.pid); child.unref(); fs.closeSync(fd); });
'@
  $ServerPid = & $Node -e $Launch $Server $Log $Repo
  if ($LASTEXITCODE -ne 0 -or !$ServerPid) { throw 'Could not launch Amygdala.' }
  $Cim = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$ServerPid)"
  if (!$Cim) { throw 'Server exited during startup; inspect amygdala logs.' }
  @{ pid = [int]$ServerPid; created = $Cim.CreationDate.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content $PidFile
  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) { Start-Sleep -Milliseconds 250; try { $null = Get-PageToken; return } catch {} }
  throw 'Server did not become ready; inspect amygdala logs.'
}
switch ($Command) {
  'start' { Start-Amygdala; 'Amygdala is running.' }
  'open' { Start-Amygdala; Start-Process $Base }
  'stop' { $Proc = Get-OwnedProcess; if ($Proc) { & taskkill.exe /pid $Proc.ProcessId /T /F | Out-Null; Remove-Item $PidFile; 'Stopped.' } else { 'No owned Amygdala process found.' } }
  'status' { try { $null = Get-PageToken; 'Amygdala is running.' } catch { 'Amygdala is not responding.' } }
  'logs' { Get-Content -Path $Log -Tail 60 -Wait }
  'pass' {
    if (!$Name) { throw 'Usage: amygdala pass <name> [label] [hours]' }
    $Token = Get-PageToken
    $Result = Invoke-RestMethod -Method Post -Uri "$Base/api/visitors/pass" -Headers @{ 'x-hearthfield-token' = $Token } -ContentType 'application/json' -Body (@{ name = $Name; label = $Label; hours = $Hours } | ConvertTo-Json)
    $Result.token
  }
  default { throw 'Commands: open, start, stop, status, logs, pass <name> [label] [hours]' }
}
