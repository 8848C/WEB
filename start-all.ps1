# ---------------------------------------------------------------------------
# 一条命令把 MySQL + 后端 + 前端都在后台拉起来，并等到全部就绪。
# 适合「打开就能看」；日常开发更推荐分开两个终端跑，日志更清楚。
#
#   .\start-all.ps1
#   .\start-all.ps1 -BackendPort 8001
#   停止：.\stop-all.ps1
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = $PSScriptRoot
$RunDir      = Join-Path $ProjectRoot '.run'
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

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

function Wait-Port {
    param([int]$TargetPort, [string]$Label, [int]$TimeoutSeconds = 60)
    for ($i = 0; $i -lt ($TimeoutSeconds * 2); $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Port -TargetPort $TargetPort) {
            Write-Host "  $Label 就绪 -> 127.0.0.1:$TargetPort" -ForegroundColor Green
            return $true
        }
    }
    Write-Host "  $Label 在 $TimeoutSeconds 秒内没有就绪" -ForegroundColor Red
    return $false
}

<#
    用 .NET 起后台进程，而不是 Start-Process：
      * PS 5.1 的 Start-Process 在环境变量里同时存在 NO_PROXY 和 no_proxy 时
        会抛「已添加项。字典中的关键字…」，.NET 这边不受影响；
      * UseShellExecute = $true 让子进程拿到自己的标准句柄，不会继承调用方的
        管道。否则从管道里调用本脚本时，脚本明明跑完了却不返回，
        因为子进程还攥着那根管道不放；
      * 输出重定向交给 cmd.exe 自己做（> log 2> err），省掉异步读流的胶水代码。
#>
function Start-Background {
    param(
        [string]$CommandLine,
        [string]$WorkingDirectory
    )

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = 'cmd.exe'
    $info.Arguments = '/c ' + $CommandLine
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $true
    $info.WindowStyle = 'Hidden'
    # 刻意不碰 $info.EnvironmentVariables：PS 5.1 里这个 StringDictionary 是惰性的，
    # 首次访问就做索引赋值会报「无法对 Null 数组进行索引」。
    # 需要额外环境变量就让 cmd 自己 set。

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "启动失败：$CommandLine" }
    return $process
}

# --------------------------- MySQL ---------------------------
& (Join-Path $ProjectRoot 'tools\start-mysql.ps1')
if ($LASTEXITCODE -ne 0) { throw 'MySQL 启动失败' }

$allOk = $true

# --------------------------- 后端 ---------------------------
if (Test-Port -TargetPort $BackendPort) {
    Write-Host "后端端口 $BackendPort 已被占用，跳过启动。" -ForegroundColor Yellow
} else {
    $pythonExe = Join-Path $ProjectRoot 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path $pythonExe)) {
        Write-Host '找不到后端虚拟环境，请先运行 .\tools\setup.ps1' -ForegroundColor Red
        $allOk = $false
    } else {
        $log = Join-Path $RunDir 'backend.log'
        $err = Join-Path $RunDir 'backend.err.log'
        $cmd = "set PYTHONIOENCODING=utf-8&& `"$pythonExe`" -m uvicorn app.main:app " +
               "--host 127.0.0.1 --port $BackendPort 1> `"$log`" 2> `"$err`""
        $backend = Start-Background -CommandLine $cmd -WorkingDirectory (Join-Path $ProjectRoot 'backend')
        Set-Content -Path (Join-Path $RunDir 'backend.pid') -Value $backend.Id
        Write-Host "后端已启动 pid=$($backend.Id)  日志 .run\backend.log" -ForegroundColor Cyan
        if (-not (Wait-Port -TargetPort $BackendPort -Label '后端')) { $allOk = $false }
    }
}

# --------------------------- 前端 ---------------------------
if (Test-Port -TargetPort $FrontendPort) {
    Write-Host "前端端口 $FrontendPort 已被占用，跳过启动。" -ForegroundColor Yellow
} else {
    $log = Join-Path $RunDir 'frontend.log'
    $err = Join-Path $RunDir 'frontend.err.log'
    $cmd = "npm.cmd run dev 1> `"$log`" 2> `"$err`""
    $frontend = Start-Background -CommandLine $cmd -WorkingDirectory (Join-Path $ProjectRoot 'frontend')
    Set-Content -Path (Join-Path $RunDir 'frontend.pid') -Value $frontend.Id
    Write-Host "前端已启动 pid=$($frontend.Id)  日志 .run\frontend.log" -ForegroundColor Cyan
    if (-not (Wait-Port -TargetPort $FrontendPort -Label '前端' -TimeoutSeconds 90)) { $allOk = $false }
}

Write-Host ''
if ($allOk) {
    Write-Host "打开 http://127.0.0.1:$FrontendPort   演示账号 admin / admin12345" -ForegroundColor Green
} else {
    Write-Host '有服务没起来，看 .run\ 下的日志。' -ForegroundColor Red
    exit 1
}
