$ErrorActionPreference = 'Stop'
$Script = (Join-Path $PSScriptRoot 'amygdala.ps1').Replace("'", "''")
$Start = '# Amygdala launcher begin'
$End = '# Amygdala launcher end'
$Block = "$Start`nfunction amygdala { & '$Script' @args }`n$End"
$Parent = Split-Path $PROFILE -Parent
New-Item -ItemType Directory -Force $Parent | Out-Null
$Old = if (Test-Path $PROFILE) { Get-Content $PROFILE -Raw } else { '' }
$Pattern = '(?ms)^# Amygdala launcher begin\r?\n.*?^# Amygdala launcher end\r?\n?'
$Clean = [regex]::Replace($Old, $Pattern, '')
Set-Content -Path $PROFILE -Value ($Clean.TrimEnd() + "`n" + $Block + "`n") -Encoding UTF8
Write-Output 'Installed. Open a new PowerShell window, then run amygdala. Use amygdala status or amygdala logs to inspect it. Install Node 22+ and authenticate your chosen CLIs first.'
