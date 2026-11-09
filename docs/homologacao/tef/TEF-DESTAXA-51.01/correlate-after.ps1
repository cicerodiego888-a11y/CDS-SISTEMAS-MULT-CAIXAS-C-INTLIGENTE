$ErrorActionPreference = 'Continue'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$windowStart = [datetime]::Parse('2026-11-09T11:04:20')
$windowEnd = [datetime]::Parse('2026-11-09T11:04:40')

function Tail-New([string]$path, [string]$label, [int]$beforeSize) {
  $item = [ordered]@{
    label = $label
    path = $path
    exists = (Test-Path $path)
    sizeBefore = $beforeSize
    sizeAfter = $null
    grew = $false
    newBytes = 0
    relevant = @()
  }
  if (-not $item.exists) { return $item }
  $fi = Get-Item $path
  $item.sizeAfter = $fi.Length
  $item.grew = $fi.Length -gt $beforeSize
  $item.newBytes = [Math]::Max(0, $fi.Length - $beforeSize)
  $copy = Join-Path $outDir ("after-$label-$stamp.log")
  Copy-Item -LiteralPath $path -Destination $copy -Force
  $item.afterCopy = $copy
  if ($item.newBytes -gt 0) {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      $fs.Seek($beforeSize, 'Begin') | Out-Null
      $sr = New-Object System.IO.StreamReader($fs)
      $delta = $sr.ReadToEnd()
      $sr.Close()
      $deltaPath = Join-Path $outDir ("delta-$label-$stamp.txt")
      Set-Content -LiteralPath $deltaPath -Value $delta -Encoding UTF8
      $item.deltaPath = $deltaPath
      $item.relevant = @(
        ($delta -split "`r?`n") |
          Where-Object {
            $_ -match 'Identificar|60906|60603|127\.0\.0\.1|iniciaClient|INIT|Connected|breaked|F1|timeout|Tempo de resposta|api_destaxa|CLIENT|Connection'
          }
      )
    } finally {
      $fs.Dispose()
    }
  } else {
    # Even without growth, search recent lines for window markers
    $lines = Get-Content -LiteralPath $path -Tail 40 -ErrorAction SilentlyContinue
    $item.relevant = @(
      $lines | Where-Object {
        $_ -match '2026-11-09 11:04|14:04:25|Identificar|60906|127\.0\.0\.1'
      }
    )
  }
  return $item
}

$snap = Get-Content -LiteralPath (Join-Path $outDir 'pre-call-log-snapshot.json') -Raw | ConvertFrom-Json
$map = @{}
foreach ($f in $snap.files) { $map[$f.label] = [int]$f.size }

$obs = Join-Path $env:LOCALAPPDATA 'CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl'
$report = [ordered]@{
  correlatedAt = (Get-Date).ToString('o')
  windowLocal = '2026-11-09 11:04:20 .. 11:04:40'
  vspaguePid = (Get-Process -Name VSPagueClient -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)
  dll = Tail-New 'C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log' 'destaxa-dll' $map['destaxa-dll']
  vspague = Tail-New 'C:\VBI\V$Pague\Client\logs\vspague-client.log' 'vspague-client' $map['vspague-client']
  observability = Tail-New $obs 'nativehost-observability' $map['nativehost-observability']
  netstat = @(netstat -ano | Select-String -Pattern ':60906|:60603' | ForEach-Object { $_.Line })
}

# Also extract observability events for the request id
$obsLines = Get-Content -LiteralPath $obs -ErrorAction SilentlyContinue
$reqEvents = @()
foreach ($line in $obsLines) {
  if ($line -match 'da029f02-a813-493d-a278-91d060e8b04a' -or $line -match '2026-11-09T14:04:25') {
    $reqEvents += $line
  }
}
$report.requestEvents = $reqEvents

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outDir 'correlacao-pos-chamada.json') -Encoding UTF8
Write-Output ((Join-Path $outDir 'correlacao-pos-chamada.json'))
Write-Output '=== DLL RELEVANT ==='
$report.dll.relevant
Write-Output '=== VSPAGUE RELEVANT ==='
$report.vspague.relevant
Write-Output '=== OBS SIZES ==='
"dll grew=$($report.dll.grew) +$($report.dll.newBytes)"
"vspague grew=$($report.vspague.grew) +$($report.vspague.newBytes)"
"obs grew=$($report.observability.grew) +$($report.observability.newBytes)"
Write-Output '=== NETSTAT ==='
$report.netstat
Write-Output '=== REQUEST EVENTS COUNT ==='
$report.requestEvents.Count
