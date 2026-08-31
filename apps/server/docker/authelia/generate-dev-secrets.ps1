$ErrorActionPreference = 'Stop'

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    throw 'OpenSSL is required to generate local Authelia credentials'
}

$certDirectory = Join-Path $PSScriptRoot 'config/certs'
$secretDirectory = Join-Path $PSScriptRoot 'config/secrets'
New-Item -ItemType Directory -Force -Path $certDirectory, $secretDirectory | Out-Null

function Write-RandomSecret([string] $Path) {
    if (-not (Test-Path $Path) -or (Get-Item $Path).Length -eq 0) {
        $value = (& openssl rand -hex 32).Trim()
        [System.IO.File]::WriteAllText($Path, $value, [System.Text.Encoding]::ASCII)
    }
}

Write-RandomSecret (Join-Path $secretDirectory 'reset_jwt_secret')
Write-RandomSecret (Join-Path $secretDirectory 'session_secret')
Write-RandomSecret (Join-Path $secretDirectory 'storage_encryption_key')
Write-RandomSecret (Join-Path $secretDirectory 'oidc_hmac_secret')

$clientSecretPath = Join-Path $secretDirectory 'oidc_client_secret'
if (-not (Test-Path $clientSecretPath) -or (Get-Item $clientSecretPath).Length -eq 0) {
    $value = '$plaintext$' + (& openssl rand -hex 32).Trim()
    [System.IO.File]::WriteAllText($clientSecretPath, $value, [System.Text.Encoding]::ASCII)
}

$jwksPath = Join-Path $secretDirectory 'oidc_jwks_private.pem'
if (-not (Test-Path $jwksPath) -or (Get-Item $jwksPath).Length -eq 0) {
    & openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $jwksPath
    if ($LASTEXITCODE -ne 0) { throw 'Failed to generate the OIDC signing key' }
}

$privateKeyPath = Join-Path $certDirectory 'private.key'
$certificatePath = Join-Path $certDirectory 'public.crt'
if (-not (Test-Path $privateKeyPath) -or -not (Test-Path $certificatePath)) {
    & openssl req -x509 -nodes -newkey rsa:2048 `
        -keyout $privateKeyPath `
        -out $certificatePath `
        -days 3650 `
        -config (Join-Path $PSScriptRoot 'openssl-dev.cnf')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to generate the local TLS certificate' }
}

Write-Host 'Generated local Authelia credentials without printing their values'
