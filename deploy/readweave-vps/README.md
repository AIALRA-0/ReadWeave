# ReadWeave VPS deployment templates

These files deliberately contain no host-specific domain, account name, or
secret. Before deployment, provide the following values in a private server
environment file or substitute them during release automation:

- `READWEAVE_IMAGE`: immutable image name and version
- `READWEAVE_BIND`: loopback address and port exposed to the reverse proxy
- `READWEAVE_DATA_DIR`: persistent Trilium data directory
- `READWEAVE_BACKUP_DIR`: protected backup directory
- `__READWEAVE_DOMAIN__`: HTTPS host name used to render the Nginx template

Keep the model API keys inside the protected Trilium data directory. Never add
the rendered Nginx file, server environment file, database, session secret, or
certificate private key to Git.
