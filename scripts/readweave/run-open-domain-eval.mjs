import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const server = join(repo, "apps/server");
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
}));
const allowed = new Set(["check", "limit", "offset", "concurrency", "run-id", "mode", "judge", "suite", "diagnostic", "retain-review"]);
function fail(code) { process.stdout.write(JSON.stringify({ error: code }) + "\n"); process.exit(1); }
process.on("uncaughtException", () => fail("launcher_error_details_suppressed"));
process.on("unhandledRejection", () => fail("launcher_error_details_suppressed"));
if (Object.keys(args).some(key => !allowed.has(key))) fail("unknown_argument");
const runId = args["run-id"] ?? `run-${new Date().toISOString().replace(/[^0-9T]/g, "")}`;
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) fail("invalid_run_id");
const run = {
    runId, check: args.check === "true", diagnostic: args.diagnostic === "true", retainReview: args["retain-review"] === "true", mode: args.mode ?? "candidate", judge: args.judge ?? "writer", suite: args.suite ?? "corpus",
    offset: Number(args.offset ?? 0), limit: Number(args.limit ?? (args.suite === "public-search" ? 5 : 100)), concurrency: Number(args.concurrency ?? 2)
};
if (!["candidate", "baseline"].includes(run.mode) || !["writer", "verifier"].includes(run.judge) || !["corpus", "public-search"].includes(run.suite)
    || !Number.isInteger(run.offset) || run.offset < 0 || !Number.isInteger(run.limit) || run.limit < 1
    || run.offset + run.limit > (run.suite === "public-search" ? 5 : 100) || !Number.isInteger(run.concurrency) || run.concurrency < 1 || run.concurrency > 4)
    fail("invalid_run_options");
const reportPath = join(server, "test-output/open-domain", `${runId}.json`);
if (existsSync(reportPath)) fail("report_already_exists_choose_new_run_id");

// Track the code actually evaluated without exposing source paths or configuration.
function sourceDigest(generationOnly = false) {
    const hash = createHash("sha256");
    for (const directory of ["apps/server/src/services", "apps/server/evals", "packages/commons/src/lib", "scripts/readweave"]) {
        if (generationOnly && !["apps/server/src/services", "packages/commons/src/lib"].includes(directory)) continue;
        for (const name of readdirSync(join(repo, directory)).sort()) {
            if (generationOnly && (name.includes(".spec.") || name.endsWith("_cases.ts"))) continue;
            if (/^readweave.*\.(ts|json)$/.test(name) || /open-domain.*\.(mjs|ts)$/.test(name)) {
                hash.update(directory + "/" + name); hash.update(readFileSync(join(repo, directory, name)));
            }
        }
    }
    if (!generationOnly) hash.update(readFileSync(join(server, "vitest.open-domain-eval.config.mts")));
    return hash.digest("hex");
}
run.sourceDigest = sourceDigest();
run.generationSourceDigest = sourceDigest(true);

// The remote script never logs paths, credentials, database rows, or exception details.
// Its sole success output is captured in this process and passed through child env.
const remote = String.raw`
import json, pathlib, sqlite3, subprocess, sys
try:
    def inspect(field):
        p = subprocess.run(['docker','inspect','--format','{{json .'+field+'}}','readweave'],capture_output=True,text=True,check=True)
        return json.loads(p.stdout)
    env = dict(x.split('=',1) for x in inspect('Config.Env') if '=' in x)
    mounts = inspect('Mounts')
    # Prefer the configured container document path; otherwise identify the unique mounted DB.
    document = env.get('TRILIUM_DOCUMENT_PATH')
    if not document and env.get('TRILIUM_DATA_DIR'):
        document = str(pathlib.PurePosixPath(env['TRILIUM_DATA_DIR'])/'document.db')
    candidates = []
    for m in mounts:
        if m['Type'] not in ('bind','volume'): continue
        if document:
            try: relative = pathlib.PurePosixPath(document).relative_to(m['Destination'])
            except ValueError: continue
            if '..' in relative.parts: raise ValueError()
            candidate = pathlib.Path(m['Source']).joinpath(*relative.parts)
        else: candidate = pathlib.Path(m['Source'])/'document.db'
        if candidate.is_file(): candidates.append(candidate)
    if len(candidates) != 1: raise ValueError()
    mapping = {
        'readWeaveApiKey':['READWEAVE_API_KEY','READWEAVE_DEEPSEEK_API_KEY'],
        'readWeaveBaseUrl':['READWEAVE_API_BASE_URL'],
        'readWeaveModel':['READWEAVE_MODEL','READWEAVE_DEEPSEEK_MODEL'],
        'readWeaveProviderType':['READWEAVE_PROVIDER_TYPE'],
        'readWeaveSerperApiKey':['SERPER_API_KEY'], 'readWeaveExaApiKey':['EXA_API_KEY'],
        'readWeaveJinaApiKey':['JINA_API_KEY'], 'readWeaveSearchMode':[], 'readWeaveSearchBudgetCny':[],
        'readWeaveCacheHitInputCnyPerMillion':[], 'readWeaveCacheMissInputCnyPerMillion':[],
        'readWeaveOutputCnyPerMillion':[],
        'readWeaveVerifierApiKey':['READWEAVE_VERIFIER_API_KEY'],
        'readWeaveVerifierBaseUrl':['READWEAVE_VERIFIER_API_BASE_URL'],
        'readWeaveVerifierModel':['READWEAVE_VERIFIER_MODEL']
    }
    db = sqlite3.connect(candidates[0].as_uri()+'?mode=ro',uri=True)
    db.execute('PRAGMA query_only=ON')
    rows = dict(db.execute('SELECT name,value FROM options WHERE name IN ('+','.join('?' for _ in mapping)+')',list(mapping)))
    harness = None
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='readweave_harness_profiles'").fetchone():
        profile = db.execute("SELECT versionId,currentRevisionId,contentDigest FROM readweave_harness_profiles WHERE status IN ('published','legacy-published') ORDER BY publishedAt DESC LIMIT 1").fetchone()
        if profile:
            revision = db.execute('SELECT modulesJson,versionId,contentDigest FROM readweave_harness_revisions WHERE revisionId=?',(profile[1],)).fetchone()
            if not revision or revision[1] != profile[0] or revision[2] != profile[2]: raise ValueError()
            harness = dict(versionId=profile[0],revisionId=profile[1],contentDigest=profile[2],modules=json.loads(revision[0]))
    db.close()
    result = {}
    for name, aliases in mapping.items():
        value = str(rows.get(name) or '').strip()
        if not value: value = next((env[k].strip() for k in aliases if env.get(k,'').strip()), '')
        result[name] = value
    if not all(result[k] for k in ['readWeaveApiKey','readWeaveBaseUrl','readWeaveModel']): raise ValueError()
    result['publishedHarness'] = harness
    sys.stdout.write(json.dumps(result))
except Exception:
    sys.exit(1)
`;

let config = "";
if (!run.check) {
    const sshTarget = (process.env.READWEAVE_EVAL_SSH_TARGET ?? "").trim();
    if (!/^[a-zA-Z0-9_.@-]{1,255}$/.test(sshTarget)) fail("ssh_target_not_configured");
    const result = spawnSync("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
        sshTarget, "python3", "-"], {
        input: remote, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
        windowsHide: true, maxBuffer: 256 * 1024
    });
    if (result.error || result.status !== 0) fail("readonly_configuration_transfer_failed");
    try { JSON.parse(result.stdout); } catch { fail("invalid_configuration_payload"); }
    config = result.stdout;
}
const env = { ...process.env };
// Avoid unrelated local credentials, stale flags and verbose network diagnostics.
for (const key of Object.keys(env)) {
    if (/^(READWEAVE_|SERPER_|EXA_|JINA_|TAVILY_|BRAVE_|SEMANTIC_SCHOLAR_|OPENALEX_|UNPAYWALL_)/i.test(key)
        || /^(NODE_DEBUG|NODE_OPTIONS|DEBUG|SSLKEYLOGFILE)$/i.test(key)) delete env[key];
}
env.READWEAVE_OPEN_DOMAIN_CONFIG = config;
env.READWEAVE_OPEN_DOMAIN_RUN = JSON.stringify(run);
env.READWEAVE_LIVE_AI = "1";
const child = spawn(process.execPath, [join(repo, "node_modules/vitest/vitest.mjs"), "run",
    "--config", "vitest.open-domain-eval.config.mts"], {
    cwd: server, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
});
config = ""; delete env.READWEAVE_OPEN_DOMAIN_CONFIG;
// Never forward framework/provider output or save its buffers. Only report fixed metadata.
child.stdout.resume(); child.stderr.resume();
let count = -1;
let generationCount = 0;
function progress() {
    try {
        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        if (report.generations?.length > generationCount) {
            for (const generation of report.generations.slice(generationCount)) {
                process.stdout.write(JSON.stringify({ runId, generation }) + "\n");
            }
            generationCount = report.generations.length;
        }
        if (report.completed !== count) {
            count = report.completed;
            process.stdout.write(JSON.stringify({ runId, completed: count, total: run.limit,
                passed: report.summary?.passed ?? 0, executionErrors: report.summary?.executionErrors ?? 0,
                judgeErrors: report.summary?.judgeErrors ?? 0 }) + "\n");
        }
    } catch { /* The report may not exist until fixture setup finishes. */ }
}
const timer = setInterval(progress, 5000);
child.on("error", () => { clearInterval(timer); fail("vitest_process_start_failed"); });
child.on("exit", code => {
    clearInterval(timer); progress();
    const sourceDigestAfter = sourceDigest();
    if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        report.launcher = { exitCode: code, sourceDigestAfter, sourceChangedDuringRun: sourceDigestAfter !== run.sourceDigest };
        report.launcher.generationSourceDigestAfter = sourceDigest(true);
        report.launcher.generationSourceChangedDuringRun = report.launcher.generationSourceDigestAfter !== run.generationSourceDigest;
        writeFileSync(reportPath, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
    }
    process.stdout.write(JSON.stringify({ runId, status: run.check && code === 0 ? "checks_passed"
        : existsSync(reportPath) ? "report_available" : "setup_failed_output_suppressed",
        exitCode: code, sourceChangedDuringRun: sourceDigestAfter !== run.sourceDigest }) + "\n");
    process.exitCode = code ?? 1;
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
