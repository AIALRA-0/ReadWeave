param(
    [int] $Port = 8082,
    [switch] $SkipBuild,
    [switch] $NoBrowser
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$serverDirectory = Join-Path $repositoryRoot "apps\server"
$dataDirectory = Join-Path $serverDirectory "data-readweave"
$pidFile = Join-Path $dataDirectory "readweave.pid"
$standardLog = Join-Path $dataDirectory "readweave.out.log"
$errorLog = Join-Path $dataDirectory "readweave.error.log"
$address = "http://127.0.0.1:$Port"

function Open-ReadWeave {
    if (-not $NoBrowser) {
        Start-Process $address
    }
}

function Get-PortOwner {
    return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
}

try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $pnpmCommand = Get-Command pnpm -ErrorAction Stop

    $existingOwner = Get-PortOwner
    if ($existingOwner) {
        $knownPid = if (Test-Path -LiteralPath $pidFile) {
            [int](Get-Content -LiteralPath $pidFile -Raw)
        } else {
            0
        }

        if ($knownPid -eq $existingOwner) {
            Write-Host "ReadWeave 已在 $address 运行，正在打开浏览器。" -ForegroundColor Green
            Open-ReadWeave
            exit 0
        }

        $ownerProcess = Get-Process -Id $existingOwner -ErrorAction SilentlyContinue
        $ownerName = if ($ownerProcess) { $ownerProcess.ProcessName } else { "未知程序" }
        throw "端口 $Port 已被 $ownerName（PID $existingOwner）占用。为避免误停其他服务，启动器没有继续。"
    }

    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

    if (-not $SkipBuild) {
        Write-Host "正在构建最新 ReadWeave，请稍候……" -ForegroundColor Cyan
        & $pnpmCommand.Source --dir $serverDirectory build
        if ($LASTEXITCODE -ne 0) {
            throw "ReadWeave 构建失败。"
        }
    }

    $env:TRILIUM_ENV = "production"
    $env:TRILIUM_PORT = [string]$Port
    $env:TRILIUM_DATA_DIR = $dataDirectory

    Write-Host "正在后台启动 ReadWeave……" -ForegroundColor Cyan
    $startArguments = @{
        FilePath = $nodeCommand.Source
        ArgumentList = "dist/main.cjs"
        WorkingDirectory = $serverDirectory
        WindowStyle = "Hidden"
        RedirectStandardOutput = $standardLog
        RedirectStandardError = $errorLog
        PassThru = $true
    }
    $serverProcess = Start-Process @startArguments
    Set-Content -LiteralPath $pidFile -Value $serverProcess.Id -NoNewline

    $deadline = (Get-Date).AddSeconds(90)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if ($serverProcess.HasExited) {
            $details = if (Test-Path -LiteralPath $errorLog) {
                (Get-Content -LiteralPath $errorLog -Tail 30) -join [Environment]::NewLine
            } else {
                "没有错误日志。"
            }
            throw "ReadWeave 启动进程提前退出。$([Environment]::NewLine)$details"
        }

        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $address -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $ready) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        throw "ReadWeave 在 90 秒内没有完成启动，请查看 $errorLog。"
    }

    Write-Host "ReadWeave 已启动：$address" -ForegroundColor Green
    Write-Host "独立数据目录：$dataDirectory"
    Open-ReadWeave
    exit 0
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
