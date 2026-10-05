# ---------------------------------------------------------------------------
# 启动项目自带的 MySQL 开发实例（端口 3307，数据在 .mysql/data）
#
#   .\tools\start-mysql.ps1              # 后台启动
#   .\tools\start-mysql.ps1 -Foreground  # 前台启动，Ctrl+C 停止
#   .\tools\start-mysql.ps1 -MySqlHome 'D:\MySQL'
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [string]$MySqlHome,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath  = Join-Path $PSScriptRoot 'mysql\my.ini'
$DataDir     = Join-Path $ProjectRoot '.mysql\data'
$LogDir      = Join-Path $ProjectRoot '.mysql\logs'
$Port        = 3307

# --------------------------- 1. 找到 mysqld ---------------------------
function Find-MySqlHome {
    param([string]$Explicit)

    $candidates = @(
        $Explicit,
        $env:MYSQL_HOME,
        'D:\MySQL',
        'C:\Program Files\MySQL\MySQL Server 9.0',
        'C:\Program Files\MySQL\MySQL Server 8.4',
        'C:\Program Files\MySQL\MySQL Server 8.0'
    ) | Where-Object { $_ }

    foreach ($mySqlRoot in $candidates) {
        $exe = Join-Path $mySqlRoot 'bin\mysqld.exe'
        if (Test-Path $exe) { return $mySqlRoot }
    }

    $onPath = Get-Command mysqld.exe -ErrorAction SilentlyContinue
    if ($onPath) { return (Split-Path -Parent (Split-Path -Parent $onPath.Source)) }

    throw "找不到 mysqld.exe。请用 -MySqlHome 指定 MySQL 安装目录，例如 -MySqlHome 'D:\MySQL'"
}

$MySqlHome = Find-MySqlHome -Explicit $MySqlHome
$MysqldExe = Join-Path $MySqlHome 'bin\mysqld.exe'
Write-Host "[mysql] 安装目录 : $MySqlHome" -ForegroundColor Cyan

# --------------------------- 2. 已经开着就别重复启动 ---------------------------
function Test-Port {
    param([int]$TargetPort)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $TargetPort)
        $open = $client.Connected
        $client.Close()
        return $open
    } catch {
        return $false
    }
}

if (Test-Port -TargetPort $Port) {
    Write-Host "[mysql] 端口 $Port 已在监听，实例应该已经启动，跳过。" -ForegroundColor Yellow
    exit 0
}

# --------------------------- 3. 首次运行要初始化数据目录 ---------------------------
New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

$IsInitialized = Test-Path (Join-Path $DataDir 'auto.cnf')
if (-not $IsInitialized) {
    Write-Host "[mysql] 数据目录为空，执行初始化（root 无密码）…" -ForegroundColor Yellow
    & $MysqldExe --defaults-file="$ConfigPath" --basedir="$MySqlHome" --initialize-insecure --console
    if ($LASTEXITCODE -ne 0) { throw "MySQL 初始化失败，请查看 $LogDir\mysqld.err" }
    Write-Host "[mysql] 初始化完成。密码由 tools\setup.ps1 或 CREATE USER 语句设置。" -ForegroundColor Green

    if (Test-Port -TargetPort $Port) {
        Write-Host "[mysql] 初始化意外启动了服务，等待退出…" -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
}

# --------------------------- 4. 启动 ---------------------------
Write-Host "[mysql] 启动实例，端口 $Port，数据目录 $DataDir" -ForegroundColor Cyan

if ($Foreground) {
    & $MysqldExe --defaults-file="$ConfigPath" --basedir="$MySqlHome" --console
    exit $LASTEXITCODE
}

Start-Process -FilePath $MysqldExe `
    -ArgumentList @("--defaults-file=$ConfigPath", "--basedir=$MySqlHome") `
    -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port -TargetPort $Port) {
        Write-Host "[mysql] 就绪：127.0.0.1:$Port（约 $([math]::Round($i * 0.5, 1)) 秒）" -ForegroundColor Green
        exit 0
    }
}

Write-Host "[mysql] 30 秒内没起来，错误日志：" -ForegroundColor Red
Get-Content (Join-Path $LogDir 'mysqld.err') -Tail 20 -ErrorAction SilentlyContinue
exit 1
