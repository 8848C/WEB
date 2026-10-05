# ---------------------------------------------------------------------------
# 停掉 start-all.ps1 拉起来的后端 / 前端（MySQL 用 tools\stop-mysql.ps1）
#
#   .\stop-all.ps1
#   .\stop-all.ps1 -IncludeMySql
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [switch]$IncludeMySql
)

$ErrorActionPreference = 'Continue'

$ProjectRoot = $PSScriptRoot
$RunDir      = Join-Path $ProjectRoot '.run'

function Stop-FromPidFile {
    param([string]$Name, [string]$PidFile)
    if (-not (Test-Path $PidFile)) {
        Write-Host "  $Name 没有 pid 文件，跳过。" -ForegroundColor DarkGray
        return
    }

    $processId = (Get-Content $PidFile -Raw).Trim()
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
        Write-Host "  $Name (pid $processId) 已不在运行。" -ForegroundColor DarkGray
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        return
    }

    # 前端是 cmd.exe 包着 npm，把整棵进程树带走
    & taskkill.exe /PID $processId /T /F *> $null
    Write-Host "  $Name (pid $processId) 已停止。" -ForegroundColor Green
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host '停止服务…' -ForegroundColor Cyan
Stop-FromPidFile -Name '后端' -PidFile (Join-Path $RunDir 'backend.pid')
Stop-FromPidFile -Name '前端' -PidFile (Join-Path $RunDir 'frontend.pid')

# 保险：按命令行特征兜一遍，防止 pid 文件缺失时留下孤儿进程
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$ProjectRoot*" } |
    ForEach-Object {
        & taskkill.exe /PID $_.ProcessId /T /F *> $null
        Write-Host "  清理残留 node 进程 pid $($_.ProcessId)" -ForegroundColor Yellow
    }

if ($IncludeMySql) {
    & (Join-Path $ProjectRoot 'tools\stop-mysql.ps1')
}

Write-Host '完成。' -ForegroundColor Green
