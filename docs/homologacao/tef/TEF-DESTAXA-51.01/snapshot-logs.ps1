$ErrorActionPreference = 'Continue'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$meta = [ordered]@{
  stamp = (Get-Date).ToString('o')
  stampLocal = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss K')
  files = @()
}

function Snapshot-File([string]$path, [string]$label) {
  $item = [ordered]@{
    label = $label
    path = $path
    exists = $false
    size = $null
    mtime = $null
    lineCount = $null
    tailPath = $null
  }
  if (Test-Path $path) {
    $fi = Get-Item $path
    $item.exists = $true
    $item.size = $fi.Length
    $item.mtime = $fi.LastWriteTime.ToString('o')
    $lines = Get-Content -LiteralPath $path -ErrorAction SilentlyContinue
    if ($null -eq $lines) { $lines = @() }
    if ($lines -isnot [System.Array]) { $lines = @($lines) }
    $item.lineCount = $lines.Count
    $tailName = "before-$label-$stamp.txt"
    $tailPath = Join-Path $outDir $tailName
    $take = [Math]::Min(80, $lines.Count)
    if ($take -gt 0) {
      $lines[($lines.Count - $take)..($lines.Count - 1)] | Set-Content -LiteralPath $tailPath -Encoding UTF8
    } else {
      Set-Content -LiteralPath $tailPath -Value '' -Encoding UTF8
    }
    $item.tailPath = $tailPath
    # Preserve original by copying full file once
    $copyName = "preserve-$label-$stamp.log"
    Copy-Item -LiteralPath $path -Destination (Join-Path $outDir $copyName) -Force
    $item.preserveCopy = (Join-Path $outDir $copyName)
  }
  return $item
}

$obs = Join-Path $env:LOCALAPPDATA 'CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl'
$meta.files += Snapshot-File 'C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log' 'destaxa-dll'
$meta.files += Snapshot-File 'C:\VBI\V$Pague\Client\logs\vspague-client.log' 'vspague-client'
$meta.files += Snapshot-File $obs 'nativehost-observability'
$meta | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outDir 'pre-call-log-snapshot.json') -Encoding UTF8
Write-Output ((Join-Path $outDir 'pre-call-log-snapshot.json'))
$meta | ConvertTo-Json -Depth 6
