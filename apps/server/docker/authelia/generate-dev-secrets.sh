#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CERT_DIR="$SCRIPT_DIR/config/certs"
SECRET_DIR="$SCRIPT_DIR/config/secrets"

if ! command -v openssl >/dev/null 2>&1; then
    echo "OpenSSL is required to generate local Authelia credentials" >&2
    exit 1
fi

umask 077
mkdir -p "$CERT_DIR" "$SECRET_DIR"

write_random_secret() {
    path="$1"
    if [ ! -s "$path" ]; then
        openssl rand -hex 32 > "$path"
    fi
}

write_random_secret "$SECRET_DIR/reset_jwt_secret"
write_random_secret "$SECRET_DIR/session_secret"
write_random_secret "$SECRET_DIR/storage_encryption_key"
write_random_secret "$SECRET_DIR/oidc_hmac_secret"

if [ ! -s "$SECRET_DIR/oidc_client_secret" ]; then
    printf '%s' '$plaintext$' > "$SECRET_DIR/oidc_client_secret"
    openssl rand -hex 32 >> "$SECRET_DIR/oidc_client_secret"
fi

if [ ! -s "$SECRET_DIR/oidc_jwks_private.pem" ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SECRET_DIR/oidc_jwks_private.pem"
fi

if [ ! -s "$CERT_DIR/private.key" ] || [ ! -s "$CERT_DIR/public.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$CERT_DIR/private.key" \
        -out "$CERT_DIR/public.crt" \
        -days 3650 \
        -config "$SCRIPT_DIR/openssl-dev.cnf"
fi

echo "Generated local Authelia credentials without printing their values"
