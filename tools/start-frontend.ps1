# ---------------------------------------------------------------------------
# 启动 Vue3 前端开发服务器（127.0.0.1:5173，/api 自动反代到 8000）
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [switch]$Build
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $ProjectRoot 'frontend'

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Host "[frontend] 依赖没装，正在执行 npm install …" -ForegroundColor Yellow
    Push-Location $FrontendDir
    & npm.cmd install --no-fund --no-audit
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
}

Set-Location $FrontendDir

if ($Build) {
    Write-Host "[frontend] 生产构建…" -ForegroundColor Cyan
    & npm.cmd run build
    exit $LASTEXITCODE
}

Write-Host "[frontend] http://127.0.0.1:5173" -ForegroundColor Cyan
& npm.cmd run dev
exit $LASTEXITCODE
