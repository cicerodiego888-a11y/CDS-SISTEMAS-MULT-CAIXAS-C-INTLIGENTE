$ErrorActionPreference = 'Stop'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dllPath = 'C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log'
$before = 10461
$fs = [System.IO.File]::Open($dllPath, 'Open', 'Read', 'ReadWrite')
try {
  $null = $fs.Seek($before, 'Begin')
  $sr = New-Object System.IO.StreamReader($fs)
  $delta = $sr.ReadToEnd()
  $sr.Close()
} finally {
  $fs.Dispose()
}
$deltaPath = Join-Path $outDir 'delta-destaxa-dll.txt'
Set-Content -LiteralPath $deltaPath -Value $delta -Encoding UTF8
Write-Output ("DLL_DELTA_BYTES=" + $delta.Length)
Write-Output '=== DLL DELTA ==='
Write-Output $delta
Write-Output '=== VSPAGUE SIZE/MTIME ==='
Get-Item 'C:\VBI\V$Pague\Client\logs\vspague-client.log' | Select-Object Length, LastWriteTime | Format-List
Write-Output '=== VSPAGUE TAIL 25 ==='
Get-Content -LiteralPath 'C:\VBI\V$Pague\Client\logs\vspague-client.log' -Tail 25
Write-Output '=== NETSTAT ==='
netstat -ano | Select-String -Pattern ':60906|:60603'
Write-Output '=== VSPAGUE PID ==='
Get-Process -Name VSPagueClient -ErrorAction SilentlyContinue | Select-Object Id, Responding | Format-List
