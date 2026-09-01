param(
    [string] $OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$repositoryParent = Split-Path -Parent $repositoryRoot
$dateStamp = Get-Date -Format "yyyyMMdd"
$packageName = "ReadWeave-Mac-DevPack-$dateStamp"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $repositoryParent
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$stageRoot = Join-Path $outputRoot $packageName
$archivePath = Join-Path $outputRoot "$packageName.zip"
$checksumPath = "$archivePath.sha256"

if ($stageRoot -eq $repositoryRoot -or -not $stageRoot.StartsWith($outputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "暂存目录不安全，已停止打包。"
}

if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
if (Test-Path -LiteralPath $checksumPath) {
    Remove-Item -LiteralPath $checksumPath -Force
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$fileList = & git -C $repositoryRoot -c core.quotepath=false ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) {
    throw "无法读取 Git 源码清单。"
}

$explicitDenyPattern = '(^|/)(node_modules|data(?:-[^/]*)?|dist|coverage|playwright-report|blob-report|test-results|readweave-private|readweave-evaluation-private)(/|$)|(^|/)\.env($|\.)|\.(db|sqlite|sqlite3|db-wal|db-shm|log|pem|p12|pfx)$'
$copied = 0

foreach ($relativePath in $fileList) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        continue
    }

    $normalizedPath = $relativePath.Replace('\', '/')
    if ($normalizedPath -match $explicitDenyPattern -and $normalizedPath -ne ".env.example") {
        continue
    }

    $sourcePath = Join-Path $repositoryRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        continue
    }

    $destinationPath = Join-Path $stageRoot $relativePath
    $destinationParent = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
    $copied++
}

if ($copied -lt 100) {
    throw "复制的源码文件异常少（$copied），已停止打包。"
}

Compress-Archive -LiteralPath $stageRoot -DestinationPath $archivePath -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($checksumPath, "$hash  $packageName.zip`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "开发包已生成：$archivePath" -ForegroundColor Green
Write-Host "SHA-256：$hash"
Write-Host "源码文件数：$copied"
