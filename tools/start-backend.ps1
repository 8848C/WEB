# ---------------------------------------------------------------------------
# 启动 FastAPI 后端（默认 127.0.0.1:8000，带热重载）
#
#   .\tools\start-backend.ps1
#   .\tools\start-backend.ps1 -Port 8001 -NoReload
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [switch]$NoReload
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir  = Join-Path $ProjectRoot 'backend'
$PythonExe   = Join-Path $BackendDir '.venv\Scripts\python.exe'

if (-not (Test-Path $PythonExe)) {
    Write-Host "[backend] 虚拟环境不存在，请先运行 .\tools\setup.ps1" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $BackendDir '.env'))) {
    Write-Host "[backend] 缺少 backend\.env，请先运行 .\tools\setup.ps1" -ForegroundColor Red
    exit 1
}

Set-Location $BackendDir
$env:PYTHONIOENCODING = 'utf-8'

Write-Host "[backend] http://127.0.0.1:$Port   文档 http://127.0.0.1:$Port/docs" -ForegroundColor Cyan

$uvicornArgs = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port")
if (-not $NoReload) { $uvicornArgs += '--reload' }

& $PythonExe @uvicornArgs
exit $LASTEXITCODE
