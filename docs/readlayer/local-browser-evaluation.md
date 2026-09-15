# Local ReadWeave browser evaluation

The reusable launcher is [scripts/readweave/run-local-e2e.mjs](../../scripts/readweave/run-local-e2e.mjs). Both this document and the launcher belong in source control; only generated data, logs, reports and traces go under the ignored `.cache/readweave-local-e2e/run-*` directories.

## Commands for Main

After Main's final build has completed, run from the repository root:

```powershell
node scripts/readweave/run-local-e2e.mjs
```

This runs both `apps/server/e2e/readweave.spec.ts` and `apps/server/e2e/readweave_user_lifecycle.spec.ts` with **one worker, zero retries and snapshot updates disabled**. At preparation time these files contain 21 tests. No Docker, provider credentials, deployment or rebuild is involved. The launcher returns the actual Playwright exit code and prints its unique artifact directory. Check `results.json` for counts and failures; traces are retained on failure.

List the selected tests without starting an app or executing browser tests:

```powershell
node scripts/readweave/run-local-e2e.mjs --list
```

Optional alternate port or targeted rerun:

```powershell
node scripts/readweave/run-local-e2e.mjs --port 8098 --grep 'same ambiguous word|follows selected answers'
```

Final bounded full client command:

```powershell
pnpm --filter @triliumnext/client test --run --maxWorkers=2 --reporter=default
```

## Prerequisites and isolation

Use the repository's installed Node dependencies and Playwright Chromium. Main must finish its existing server build, including the current client assets, before launching. Required inputs include `apps/server/dist/main.cjs`, `apps/server/dist/public/index.html`, server assets and the original integration fixture database. Do not rebuild or replace `dist` while the suite is running. The launcher checks required paths but cannot prove that a build corresponds to every current source edit; Main owns that build-to-source association.

Port 8097 must be free unless overridden. The launcher refuses to reuse another process. It starts the existing server bundle bound to `127.0.0.1`, with an absolute resource path, `TRILIUM_INTEGRATION_TEST=memory` and `READWEAVE_TEST_AI=mock`. The original fixture is read into memory. Each run gets a fresh data directory; fixture note/settings writes stay in the local test instance.

The isolated test instance sets `TRILIUM_GENERAL_NOAUTHENTICATION=true`, matching the existing browser fixture's login assumptions, and disables backups. This is a child-process environment setting, not a change to a production configuration file. Ambient `TRILIUM_*`, `READWEAVE_*`, `BASE_URL` and `CI` values are excluded before the launcher supplies its test settings. Do not supply production credentials or user databases.

The launcher waits for a successful JSON response from `/api/options`. An HTTP 200 from the app shell is insufficient: it can still be a login screen. Startup errors remain in the run's `server.log`. The generated test configuration imports the shared Playwright base directly and has no `webServer` fallback, so failed readiness cannot start a second server or trigger a build. It also avoids the default server config's copy into `spec/db`.

The launcher stops only the processes it started, including its browser children on interruption. It retains all run artifacts and does not delete or update source snapshots. A subsequent run receives a new directory rather than overwriting a prior failure report.

## What this evaluates

This is real browser execution with deterministic AI responses. It tests user interactions, request contents, flags, async jobs, saved-result identity, follow-ups and article integrity. It is not a real model semantic score; see [open-domain-evaluation.md](open-domain-evaluation.md) for that distinction and the independently authored semantic corpus.

The new ambiguous-word regression selects `kernel` in an operating-system article and a linear-algebra article. It checks complete original article context, absence of the other article's context, no inherited answer-parent selection, preserved generation flags, one distinct saved result per article, restoration after switching/reload, zero article-body PUTs after setup, unchanged stored bodies and zero `pageerror` events.

The prior targeted run passed all five selected tests in 38.9 seconds: ambiguous-word switching, whole-article context, automatic save, answer follow-ups and read-only interaction. Earlier local launch attempts failed before those assertions because of resource-path/login prerequisites; those failures are not semantic failures. The final full browser run used the launcher above with one worker and passed all 21 discovered paths without retry.

## Client result interpretation

The final full client run on 2026-09-15 passed **189 files and all 2,366 tests, with zero failures**; process exit code was 0. This is one complete run, not combined totals from retries.

The earlier unbounded full client run reported 188 passing files and one failed Mermaid suite setup hook, with 2,355 passed and 3 skipped tests. Those three skipped tests were the Mermaid cases whose setup timed out, not a historical skip list or intentional exclusions. The isolated Mermaid retry passed all three, and the final bounded full run supersedes that partial result. Panel-style and generation-preference checks after the small UI change also passed 11/11.

Launcher validation on 2026-09-15: `node --check` succeeded; `--list` discovered 21 tests in the two intended files, and the subsequent full run passed 21/21 with deterministic model responses, an in-memory database and no retry. This proves browser behavior and article-integrity invariants, not real-provider answer quality.
