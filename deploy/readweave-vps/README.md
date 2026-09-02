# ReadWeave VPS deployment templates

These files deliberately contain no host-specific domain, account name, or
secret. Before deployment, provide the following values in a private server
environment file or substitute them during release automation:

- `READWEAVE_IMAGE`: immutable image name and version
- `READWEAVE_BIND`: loopback address and port exposed to the reverse proxy
- `READWEAVE_DATA_DIR`: persistent Trilium data directory
- `READWEAVE_BACKUP_DIR`: protected backup directory
- `__READWEAVE_DOMAIN__`: HTTPS host name used to render the Nginx template

The production verifier is supplied separately by the operator in:

```text
/srv/aialra/secrets/readweave-verifier.env
```

It must be owned by `root:root` with mode `0600` and contain only the
non-empty variables `READWEAVE_VERIFIER_API_KEY`,
`READWEAVE_VERIFIER_API_BASE_URL`, and `READWEAVE_VERIFIER_MODEL`. The
verifier origin and model family must differ from the writer. Do not put the
values in Git, the rendered Nginx file, a command line, a log, a note, or a
chat message. The ReadWeave application token is not a verifier credential.

The rendered site configuration includes the shared AIALRA authentication
endpoints and identity headers. Its route contract is deliberately narrow:

- `/` keeps browser navigation behind the AIALRA SSO redirect.
- `/api/*` and `/bootstrap` require SSO and return `401` JSON with
  `X-AIALRA-Auth-Required: 1` and `Cache-Control: no-store` when unauthenticated;
  they never return login HTML to an API caller.
- `/src/*` is the anonymous, versioned client-resource surface only. It does
  not make API, note, attachment, database, or ETAPI content public.
- `/etapi` and `/etapi/*` return `404`.
- An unauthenticated WebSocket upgrade returns `401`; normal page requests
  still redirect to SSO.

Before reload, render the site-specific file, preserve a timestamped private
copy of the active file, run `nginx -t`, and only then run
`systemctl reload nginx`. Never add the rendered Nginx file, server
environment file, database, session secret, or certificate private key to Git.
