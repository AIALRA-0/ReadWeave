param(
    [int] $Port = 8082
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dataDirectory = Join-Path $repositoryRoot "apps\server\data-readweave"
$pidFile = Join-Path $dataDirectory "readweave.pid"

try {
    if (-not (Test-Path -LiteralPath $pidFile)) {
        Write-Host "没有找到 ReadWeave 的运行记录；无需停止。" -ForegroundColor Yellow
        exit 0
    }

    $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-Item -LiteralPath $pidFile -Force
        Write-Host "ReadWeave 已经停止，过期运行记录已清理。" -ForegroundColor Yellow
        exit 0
    }

    $portOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue).CommandLine
    if ($portOwner -ne $processId -or $process.ProcessName -ne "node" -or $commandLine -notmatch "dist[\\/]main\.cjs") {
        throw "运行记录指向的进程与 ReadWeave 服务不一致。为避免误停其他程序，启动器没有执行停止。"
    }

    Stop-Process -Id $processId
    Wait-Process -Id $processId -Timeout 15 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "ReadWeave 已停止。" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "停止失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
