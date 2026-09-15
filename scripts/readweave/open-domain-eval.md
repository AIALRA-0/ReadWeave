# Private open-domain live evaluation

Run from the repository root using the installed Node/Vitest dependencies:

```sh
# No SSH, credentials, or provider calls:
node scripts/readweave/run-open-domain-eval.mjs --check --run-id=check-01

# Paid: fixed first ten development cases, one Vitest worker, two concurrent cases:
node scripts/readweave/run-open-domain-eval.mjs --limit=10 --concurrency=2 --run-id=dev10-01

# Paid: all 100 cases (60 dev / 40 holdout):
node scripts/readweave/run-open-domain-eval.mjs --concurrency=2 --run-id=candidate100-01

# Paid paired baseline: identical request, writer, full skill and evidence;
# only the server-owned interpretationMode='root-only' skips the planner:
node scripts/readweave/run-open-domain-eval.mjs --mode=baseline --concurrency=2 --run-id=baseline100-01

# Paid, separate suite: five real primary-document retrieval cases:
node scripts/readweave/run-open-domain-eval.mjs --suite=public-search --concurrency=1 --run-id=public5-01
```

`--offset=N --limit=N` selects a fixed contiguous subset. Run IDs must be new;
the launcher refuses to overwrite a previous report. Generation calls are never
automatically repeated. A fully metered malformed judge verdict may be retried
once on the same in-memory answer; both attempt costs remain in the report.
Transport errors and semantic failures do not trigger this retry.
The default mode is candidate, with a maximum of four
concurrent cases and exactly one Vitest worker.

## Configuration and privacy

Set `READWEAVE_EVAL_SSH_TARGET` to an SSH config alias or `user@host` before a
live run. The launcher uses that operator-supplied target and inspects only
the `readweave` container's environment and mount metadata. It finds the mounted
application database internally, opens SQLite with `mode=ro` and `query_only`,
and selects an allowlist of model/search options. Nonempty stored options take
precedence over container environment aliases. There is no application login,
authentication override, production write, deployment, or credential file.

The same read-only connection retrieves the published harness revision's modules
and IDs after verifying profile/revision linkage. It never retrieves harness
cases or production articles. Missing published profiles use the shipped default,
explicitly labeled. Reports retain version and module digest, never module text.

SSH stdout is captured in memory and passed to the Vitest child through its
environment. The worker removes its environment copy after creating settings
closures. The test fixture database is in memory. Before the standard setup
constructs its file logger, an eval-only mock replaces that logger with a no-op.
Console output and child stdout/stderr are discarded. Do not invoke the config
directly or enable framework/HTTP debug output.

Candidate and baseline call the production `generateReadWeaveAnswer` wrapper,
with its actual quality checker and full published harness. The generator receives
the original question and complete context only. The
independent corpus concepts/tasks never reach its planner or writer. Search is
disabled for this fictional corpus, including the baseline; configured Serper,
Exa and Jina credentials are available but unused. A model-only fetch allowlist
prevents accidental external retrieval. These runs do not measure live search.

## Meaning judge and accounting

The default judge is a separate invocation of the configured writer model, with
an independent evaluation prompt and corpus references, never the writer's plan
or self-assessment. This is **not a claim of model-family independence or human
calibration**. `--judge=verifier` selects the separately configured verifier; use
the same choice for paired comparisons. Compatible-model tariffs may be fallback
estimates, explicitly identified by `priceBasis`.

Every required concept and expected task is judged by meaning as met, partial,
unmet or unjudged. Forbidden assertions are judged with negation/attribution
awareness. The judge cites numbered answer lines; the runner validates the IDs
in memory. English reference labels are not substring requirements. Missing or
invalid judgments cannot pass. Additional flags cover unsupported claims, target
drift, false abandonment, date/version mistakes and reference/support errors.

Each generation receives its own server budget with a hard CNY 0.10 ceiling.
Judge calls have a separate CNY 0.15 preflight estimate allowance and are never
charged to that question's production ledger. Costs computed from provider token
usage and configured tariffs are **estimates**, not provider billing receipts.
Missing usage retains unsettled reservations; it is never represented as a free
request. Compatible-provider fallback tariffs are not verified billing rates.

## Sanitized reports

Reports are written incrementally under `apps/server/test-output/open-domain/`
as `<run-id>.json`. They include IDs, split/family/slice aggregates, every quality
obligation result, fixed diagnostic codes, cost accounting and latency. No answer,
article, quote, raw provider response, private endpoint or credential is written.
Evidence line numbers are retained without their text. Report integrity checks
also reject any output containing a provisioned key.

Exit code zero means every selected case passed (or offline checks passed).
Nonzero may mean semantic failures; inspect the sanitized report before treating
it as a provisioning failure. Progress appears when generation finishes, before
judging, and again when the complete case result is available.

The first dev10 diagnostic used exact-quote evidence validation. Its unjudged
outcomes are not established generator errors. Subsequent runs use numbered line
references. Keep these protocols separate when reporting results. Freeze the
judge prompt and candidate before holdout comparison. The launcher fingerprints
source at startup and reports whether it changed while running; changes to the
candidate require qualification of paired causal comparisons.

The early dev10 reports and interrupted candidate100-01 used the core generator
directly, not the production wrapper. They are explicitly labeled core-only.
Their interpretationStatus field used an obsolete allowlist and is not reliable;
wrapper reports use accepted/fallback/not_needed. Error metadata is limited to
an allowlisted exception type and a server-relative module/function/line.

Create an empty `<run-id>.json.stop` beside a running report to stop scheduling
new cases while already-paid calls finish. A forced termination can lose in-flight
accounting; completed-case totals then do not establish total run spend.

## Separate public search suite

The five public cases use independently authored obligations based on
[Python dict documentation](https://docs.python.org/3/builtins/stdtypes.html#dict),
[Node streams](https://nodejs.org/api/stream.html#event-drain),
[SQLite WAL](https://www.sqlite.org/wal.html),
[MDN Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all),
and [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2).
These are stable documentation facts, not a current-events benchmark.

This suite restores configured search mode and keys and uses the real search
gateway. It requires actual retrieval traffic and an expected primary source in
the task evidence, in addition to semantic quality. It records provider counts,
search costs and primary URLs (credentials/query strings removed), with explicit
task-evidence admission flags. Retrieved excerpts go only to the in-memory judge.
The original 100-case suite stays search-disabled. The public suite does not
replace or increase its corpus count.
