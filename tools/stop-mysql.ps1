# ---------------------------------------------------------------------------
# 停止项目自带的 MySQL 开发实例（优先走 mysqladmin shutdown，失败再按进程杀）
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [string]$MySqlHome,
    [string]$RootPassword = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port        = 3307
$PidFile     = Join-Path $ProjectRoot '.mysql\mysqld.pid'

function Find-MySqlHome {
    param([string]$Explicit)
    $candidates = @($Explicit, $env:MYSQL_HOME, 'D:\MySQL') | Where-Object { $_ }
    foreach ($mySqlRoot in $candidates) {
        if (Test-Path (Join-Path $mySqlRoot 'bin\mysqladmin.exe')) { return $mySqlRoot }
    }
    $onPath = Get-Command mysqladmin.exe -ErrorAction SilentlyContinue
    if ($onPath) { return (Split-Path -Parent (Split-Path -Parent $onPath.Source)) }
    return $null
}

$mySqlRoot = Find-MySqlHome -Explicit $MySqlHome

if ($mySqlRoot) {
    $mysqladmin = Join-Path $mySqlRoot 'bin\mysqladmin.exe'
    $adminArgs = @('--protocol=tcp', '-h', '127.0.0.1', '-P', "$Port", '-u', 'root')
    if ($RootPassword) { $adminArgs += "-p$RootPassword" }
    $adminArgs += 'shutdown'

    Write-Host "[mysql] 尝试优雅关闭…" -ForegroundColor Cyan
    & $mysqladmin @args 2>&1 | Out-Null
}

Start-Sleep -Seconds 2

$alive = Get-Process mysqld -ErrorAction SilentlyContinue
if ($alive) {
    Write-Host "[mysql] 仍有 mysqld 进程，强制结束（pid: $($alive.Id -join ', ')）" -ForegroundColor Yellow
    $alive | Stop-Process -Force
    Start-Sleep -Seconds 1
}

$remaining = Get-Process mysqld -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "[mysql] 停止失败，请手动处理。" -ForegroundColor Red
    exit 1
}

Write-Host "[mysql] 已停止。" -ForegroundColor Green
