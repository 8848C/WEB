# ---------------------------------------------------------------------------
# 一键初始化（幂等，可以反复运行）
#
#   1. 启动项目自带的 MySQL 实例（没有数据目录就先 --initialize-insecure）
#   2. 建库 kun_login + 建应用账号 kun
#   3. 建 Python 虚拟环境并安装 backend\requirements.txt
#   4. 由 .env.example 生成 backend\.env（随机 SECRET_KEY）
#   5. 建表并写入演示账号 admin / admin12345
#
#   .\tools\setup.ps1
#   .\tools\setup.ps1 -MySqlHome 'D:\MySQL' -MySqlRootPassword '你的root密码'
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [string]$MySqlHome,
    [string]$MySqlRootPassword = '',
    [string]$DbName = 'kun_login',
    [string]$DbUser = 'kun',
    [string]$DbPassword = 'kun_dev_2026'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir  = Join-Path $ProjectRoot 'backend'
$EnvFile     = Join-Path $BackendDir '.env'
$EnvExample  = Join-Path $BackendDir '.env.example'
$VenvDir     = Join-Path $BackendDir '.venv'
$Port        = 3307

function Write-Step {
    param([string]$Text)
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

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

function Find-MySqlBin {
    param([string]$Explicit, [string]$Exe)
    $candidates = @($Explicit, $env:MYSQL_HOME, 'D:\MySQL',
        'C:\Program Files\MySQL\MySQL Server 9.0',
        'C:\Program Files\MySQL\MySQL Server 8.4',
        'C:\Program Files\MySQL\MySQL Server 8.0') | Where-Object { $_ }
    foreach ($mySqlRoot in $candidates) {
        $path = Join-Path $mySqlRoot "bin\$Exe"
        if (Test-Path $path) { return $path }
    }
    $onPath = Get-Command $Exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

# ---------------------------------------------------------------------------
Write-Step '1/5  MySQL 实例'
# ---------------------------------------------------------------------------
if (Test-Port -TargetPort $Port) {
    Write-Host "[mysql] 端口 $Port 已在监听，跳过启动。" -ForegroundColor Green
} else {
    & (Join-Path $PSScriptRoot 'start-mysql.ps1') -MySqlHome $MySqlHome
    if ($LASTEXITCODE -ne 0) { throw 'MySQL 启动失败' }
}

$mysqlExe = Find-MySqlBin -Explicit $MySqlHome -Exe 'mysql.exe'
if (-not $mysqlExe) { throw "找不到 mysql.exe，请用 -MySqlHome 指定 MySQL 安装目录" }

# ---------------------------------------------------------------------------
Write-Step '2/5  建库与账号'
# ---------------------------------------------------------------------------
$rootArgs = @('--protocol=tcp', '-h', '127.0.0.1', '-P', "$Port", '-u', 'root',
              '--default-character-set=utf8mb4')
if ($MySqlRootPassword) { $rootArgs += "-p$MySqlRootPassword" }

$probe = & $mysqlExe @rootArgs -e 'SELECT 1;' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[mysql] 用 root 连不上，输出如下：" -ForegroundColor Red
    $probe | ForEach-Object { Write-Host "  $_" }
    throw "请确认 root 密码，或用 -MySqlRootPassword 'xxx' 再跑一次"
}

$sql = @"
CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DbUser'@'127.0.0.1' IDENTIFIED BY '$DbPassword';
CREATE USER IF NOT EXISTS '$DbUser'@'localhost' IDENTIFIED BY '$DbPassword';
ALTER USER '$DbUser'@'127.0.0.1' IDENTIFIED BY '$DbPassword';
ALTER USER '$DbUser'@'localhost' IDENTIFIED BY '$DbPassword';
GRANT ALL PRIVILEGES ON $DbName.* TO '$DbUser'@'127.0.0.1';
GRANT ALL PRIVILEGES ON $DbName.* TO '$DbUser'@'localhost';
FLUSH PRIVILEGES;
"@
$sql | & $mysqlExe @rootArgs 2>&1 | Where-Object { $_ -notmatch 'Using a password' }
if ($LASTEXITCODE -ne 0) { throw '建库 / 建账号失败' }
Write-Host "[mysql] 数据库 $DbName、账号 $DbUser 就绪。" -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step '3/5  Python 虚拟环境'
# ---------------------------------------------------------------------------
$PythonExe = Join-Path $VenvDir 'Scripts\python.exe'

if (-not (Test-Path $PythonExe)) {
    Write-Host '[python] 创建 venv …' -ForegroundColor Yellow
    python -m venv $VenvDir
}

# 某些受限环境里 venv 的 ensurepip 会被文件权限挡住，这里兜一下
$pipOk = $false
try {
    & $PythonExe -m pip --version *> $null
    $pipOk = ($LASTEXITCODE -eq 0)
} catch {
    $pipOk = $false
}

if (-not $pipOk) {
    Write-Host '[python] venv 里没有 pip，执行 ensurepip 补齐 …' -ForegroundColor Yellow
    & $PythonExe -m ensurepip --upgrade
}

Write-Host '[python] 安装依赖 …' -ForegroundColor Yellow
& $PythonExe -m pip install --disable-pip-version-check --no-input `
    -r (Join-Path $BackendDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install 失败' }

# ---------------------------------------------------------------------------
Write-Step '4/5  生成 backend\.env'
# ---------------------------------------------------------------------------
if (Test-Path $EnvFile) {
    Write-Host '[env] backend\.env 已存在，保留不动。' -ForegroundColor Green
} else {
    $secret = & $PythonExe -c "import secrets; print(secrets.token_urlsafe(48))"
    $content = Get-Content $EnvExample -Raw
    $content = $content -replace 'SECRET_KEY=.*', "SECRET_KEY=$secret"
    $content = $content -replace 'DB_PORT=.*', "DB_PORT=$Port"
    $content = $content -replace 'DB_USER=.*', "DB_USER=$DbUser"
    $content = $content -replace 'DB_PASSWORD=.*', "DB_PASSWORD=$DbPassword"
    $content = $content -replace 'DB_NAME=.*', "DB_NAME=$DbName"
    Set-Content -Path $EnvFile -Value $content -Encoding utf8 -NoNewline
    Write-Host '[env] 已生成 backend\.env（SECRET_KEY 随机）。' -ForegroundColor Green
}

# ---------------------------------------------------------------------------
Write-Step '5/5  建表 + 演示账号'
# ---------------------------------------------------------------------------
Push-Location $BackendDir
$env:PYTHONIOENCODING = 'utf-8'
& $PythonExe scripts\init_db.py
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw 'init_db.py 执行失败' }

Write-Host "`n全部就绪。" -ForegroundColor Green
Write-Host '接下来开两个终端：' -ForegroundColor Cyan
Write-Host '  .\tools\start-backend.ps1     # http://127.0.0.1:8000'
Write-Host '  .\tools\start-frontend.ps1    # http://127.0.0.1:5173'
Write-Host '演示账号：admin / admin12345'
