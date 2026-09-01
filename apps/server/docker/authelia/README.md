# Authelia (for testing OpenID Connect / SSO login)

A throwaway [Authelia](https://www.authelia.com/) OIDC provider for testing Trilium's
OpenID Connect login locally — and for reproducing
[issue #6387](https://github.com/TriliumNext/Trilium/issues/6387) (Trilium not reading
`name`/`email` from the UserInfo endpoint when a spec-compliant provider keeps them out
of the ID token).

> **DEV ONLY.** Generate credentials locally before starting the container. The generated
> secrets, signing key, and TLS private key are ignored by Git. Never reuse them outside this
> local test environment.

## Why a hosts entry is needed

Unlike a plain reverse proxy, OIDC shares one **issuer URL** between two callers: your
**browser** (which gets redirected to Authelia to log in) and the **Trilium server**
(which calls Authelia's token + userinfo endpoints over the back channel). Both must reach
Authelia at the same name. Authelia also refuses a bare `localhost` session-cookie domain
(it has no dot), so the portal runs on `auth.example.com`.

Add this line to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows,
`/etc/hosts` on Linux/macOS — needs admin):

```
127.0.0.1 auth.example.com
```

Trilium's own redirect target stays on `localhost:8080` (a loopback host, which is the only
way Authelia will accept an `http://` redirect URI), so no entry is needed for it.

Authelia 4.39 also **requires HTTPS** for its portal URL, so it's served with a self-signed
cert for `auth.example.com` (in `config/certs/`). Your browser will warn the first time —
click through. Trilium's back channel must trust it too; see step 3.

## Quick start

1. Generate local credentials and a self-signed certificate:

   ```bash
   ./generate-dev-secrets.sh
   ```

   On Windows PowerShell, run:

   ```powershell
   .\generate-dev-secrets.ps1
   ```

2. Start Authelia:

   ```bash
   docker compose up -d
   # tail logs to confirm it booted: docker compose logs -f authelia
   ```

   The portal is at **https://auth.example.com:9091**. The local test account is defined in
   `config/users_database.yml`; replace it before exposing this stack beyond localhost.

3. Start Trilium on the host (default port 8080) with these environment variables set:

   ```bash
   export TRILIUM_OAUTH_CLIENT_SECRET="$(sed 's/^\$plaintext\$//' apps/server/docker/authelia/config/secrets/oidc_client_secret)"
   export TRILIUM_OAUTH_BASE_URL=http://localhost:8080
   export TRILIUM_OAUTH_CLIENT_ID=trilium
   export TRILIUM_OAUTH_ISSUER_BASE_URL=https://auth.example.com:9091
   export TRILIUM_OAUTH_ISSUER_NAME=Authelia
   export TRILIUM_OAUTH_ISSUER_ICON=https://auth.example.com:9091/favicon.ico
   # So Node trusts the self-signed Authelia cert on the back channel (token/userinfo calls):
   export NODE_EXTRA_CA_CERTS=apps/server/docker/authelia/config/certs/public.crt
   ```

   For `pnpm run server:start`, export them first. PowerShell:

   ```powershell
   $secretPath = "$PWD\apps\server\docker\authelia\config\secrets\oidc_client_secret"
   $env:TRILIUM_OAUTH_CLIENT_SECRET = (Get-Content $secretPath -Raw).Replace('$plaintext$', '').Trim()
   $env:TRILIUM_OAUTH_CLIENT_ID = 'trilium'
   $env:NODE_EXTRA_CA_CERTS = "$PWD\apps\server\docker\authelia\config\certs\public.crt"
   # ...etc
   ```

   (Quick-and-dirty alternative to `NODE_EXTRA_CA_CERTS`: `NODE_TLS_REJECT_UNAUTHORIZED=0` —
   disables TLS verification globally, dev only.)

4. In Trilium, open **Options → MFA**, choose **OpenID Connect** as the method, then enroll:
   the owner must already be signed in (password) before binding the SSO identity — see
   `afterCallback` in [apps/server/src/services/open_id.ts](../../src/services/open_id.ts).

5. Log out and sign in via the **Authelia** button. The browser bounces through
   `auth.example.com:9091` and back to `localhost:8080/callback`.

## Reproducing issue #6387 vs. the workaround

- **Reproduce the bug (default):** the shipped config has **no** `claims_policy`, so Authelia
  returns `name`/`email` only from the UserInfo endpoint. On `main`/released builds this throws
  `Cannot read properties of undefined (reading 'toString')`; on the `feature/oauth_improvements`
  branch it no longer crashes but enrolls with a **blank name/email** in settings.

- **Test the Authelia-side workaround:** in [config/configuration.yml](config/configuration.yml),
  uncomment the `claims_policy: 'trilium'` line on the client and the `claims_policies:` block,
  then `docker compose restart authelia`. Now `name`/`email` ride in the ID token and the fields
  populate. (You may need to clear cookies for `auth.example.com` between runs.)

## Cleanup

```bash
docker compose down -v
```

## Notes

- `generate-dev-secrets.sh` and `generate-dev-secrets.ps1` preserve existing local files, so
  rerunning either script does not silently rotate credentials.
- Delete the generated files under `config/secrets/` and `config/certs/` before rerunning a
  generator when deliberate rotation is required.
- The generated OIDC client secret uses Authelia's explicit local-development plaintext
  marker so Trilium can read the same value. Do not expose this stack to an untrusted network.
- The "no access_control rules ... default_policy 'one_factor'" warning is expected for this
  minimal local configuration.
