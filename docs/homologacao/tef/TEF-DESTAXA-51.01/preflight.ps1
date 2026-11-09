$ErrorActionPreference = 'Continue'
Write-Output '=== DATETIME ==='
Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'
Write-Output '=== GATE ==='
Write-Output ("Process DESTAXA_REAL_TRANSACTION_ENABLED=" + [string]$env:DESTAXA_REAL_TRANSACTION_ENABLED)
$u = [Environment]::GetEnvironmentVariable('DESTAXA_REAL_TRANSACTION_ENABLED', 'User')
$m = [Environment]::GetEnvironmentVariable('DESTAXA_REAL_TRANSACTION_ENABLED', 'Machine')
Write-Output ("User DESTAXA_REAL_TRANSACTION_ENABLED=" + [string]$u)
Write-Output ("Machine DESTAXA_REAL_TRANSACTION_ENABLED=" + [string]$m)
Write-Output '=== VSPAGUE ==='
Get-CimInstance Win32_Process -Filter "Name='VSPagueClient.exe'" -ErrorAction SilentlyContinue |
  Select-Object ProcessId, ExecutablePath, CommandLine |
  Format-List | Out-String
Get-Process -Name VSPagueClient -ErrorAction SilentlyContinue |
  Select-Object Id, Responding, StartTime |
  Format-List | Out-String
Write-Output '=== NETSTAT VSPAGUE PORTS ==='
netstat -ano | Select-String -Pattern ':60906|:60603' | ForEach-Object { $_.Line }
Write-Output '=== COM4 ==='
Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue |
  Where-Object { $_.DeviceID -match 'COM4' } |
  Select-Object DeviceID, Name, Status, PNPDeviceID |
  Format-List | Out-String
Get-PnpDevice -Class Ports -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'PPC-920|PPC-930|COM4|COM3' } |
  Select-Object Status, Class, FriendlyName, InstanceId |
  Format-Table -AutoSize | Out-String
Write-Output '=== NATIVEHOST PROCESSES ==='
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.CommandLine -and ($_.CommandLine -match 'DestaxaNativeHost|cds-tef-native-host|NativeHost')) -or
    ($_.Name -match 'DestaxaNativeHost')
  } |
  Select-Object ProcessId, Name, CommandLine |
  Format-List | Out-String
Write-Output '=== LOG FILES ==='
$obs = Join-Path $env:LOCALAPPDATA 'CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl'
@(
  'C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log',
  'C:\VBI\V$Pague\Client\logs\vspague-client.log',
  $obs
) | ForEach-Object {
  if (Test-Path $_) {
    $i = Get-Item $_
    Write-Output ("EXISTS size=$($i.Length) mtime=$($i.LastWriteTime.ToString('o')) path=$_")
  } else {
    Write-Output ("MISSING path=$_")
  }
}
