#!/usr/bin/env node
// Run the built app locally with fixture data. This launcher never builds or deploys.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverDir = path.join(repoRoot, "apps/server");
const distDir = path.join(serverDir, "dist");
const fixture = path.join(repoRoot, "packages/trilium-core/src/test/fixtures/document.db");
let port = 8097;
let grep;
let listOnly = false;
for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === "--list") listOnly = true;
    else if (arg === "--port") {
        const value = process.argv[++index];
        if (!value || !/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
            throw new Error("--port requires an integer from 1024 through 65535");
        }
        port = Number(value);
    } else if (arg === "--grep") {
        grep = process.argv[++index];
        if (!grep || grep.startsWith("--")) throw new Error("--grep requires a Playwright title pattern");
    } else if (arg === "--help") {
        console.log("node scripts/readweave/run-local-e2e.mjs [--port 8097] [--grep PATTERN] [--list]");
        process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
}

function stopOwnedChild(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
        // Only a child launched below is passed here; also close its browser children.
        spawnSync("taskkill", [ "/PID", String(child.pid), "/T", "/F" ], { windowsHide: true, stdio: "ignore" });
    } else child.kill("SIGTERM");
}

function completion(child) {
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", code => resolve(code ?? 1));
    });
}

async function requireFreePort() {
    const probe = createServer();
    await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(resolve));
    });
}

async function main() {
    const cli = require.resolve("@playwright/test/cli");
    if (!listOnly) {
        for (const requiredPath of [ fixture, path.join(distDir, "main.cjs"), path.join(distDir, "public/index.html"), path.join(distDir, "assets/db/demo.zip") ]) {
            if (!existsSync(requiredPath)) throw new Error(`Missing prerequisite: ${requiredPath}. Finish Main's build first; this launcher will not rebuild.`);
        }
        await requireFreePort();
    }
    const cacheDir = path.join(repoRoot, ".cache/readweave-local-e2e");
    mkdirSync(cacheDir, { recursive: true });
    const runDir = mkdtempSync(path.join(cacheDir, "run-"));
    const dataDir = path.join(runDir, "data");
    mkdirSync(dataDir);
    const baseURL = `http://127.0.0.1:${port}`;
    // Do not inherit a production data/config path or a different ReadWeave mode.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TRILIUM_|READWEAVE_|BASE_URL$|CI$)/i.test(key)));
    Object.assign(env, {
        NODE_ENV: "production", TRILIUM_ENV: "production", BASE_URL: baseURL,
        TRILIUM_PORT: String(port), TRILIUM_NETWORK_HOST: "127.0.0.1",
        TRILIUM_RESOURCE_DIR: distDir, TRILIUM_DATA_DIR: dataDir,
        TRILIUM_DOCUMENT_PATH: fixture, TRILIUM_INTEGRATION_TEST: "memory",
        TRILIUM_GENERAL_NOAUTHENTICATION: "true", TRILIUM_GENERAL_NOBACKUP: "true",
        READWEAVE_TEST_AI: "mock"
    });
    const configPath = path.join(runDir, "playwright.config.ts");
    const baseConfigPath = path.join(repoRoot, "packages/trilium-e2e/src/base-config.ts").replaceAll("\\", "/");
    // Import the shared base, not apps/server/playwright.config.ts: its startup
    // fallback builds the app and copies a database into spec/db. Neither is needed.
    writeFileSync(configPath, `import { createBaseConfig } from ${JSON.stringify(baseConfigPath)};
const base = createBaseConfig({ appDir: ${JSON.stringify(serverDir)}, localTestDir: "e2e", projectName: "server", workers: 1 });
export default {
    ...base,
    projects: base.projects.filter(project => project.name === "server"),
    retries: 0,
    updateSnapshots: "none",
    outputDir: ${JSON.stringify(path.join(runDir, "artifacts"))},
    reporter: [["list"], ["json", { outputFile: ${JSON.stringify(path.join(runDir, "results.json"))} }]],
    use: { ...base.use, baseURL: ${JSON.stringify(baseURL)}, trace: "retain-on-failure" }
};
`);
    console.log(`Artifacts: ${runDir}`);
    console.log(listOnly ? "Listing tests only; no app or browser suite will start." : `Using existing build at ${distDir}; loopback ${baseURL}; one worker; mock AI; memory database.`);
    let server;
    let runner;
    let logFd;
    let interrupted = false;
    const interrupt = () => {
        interrupted = true;
        stopOwnedChild(runner);
        stopOwnedChild(server);
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
        if (!listOnly) {
            logFd = openSync(path.join(runDir, "server.log"), "w");
            server = spawn(process.execPath, [ path.join(distDir, "main.cjs") ], {
                cwd: serverDir, env, windowsHide: true, stdio: [ "ignore", logFd, logFd ]
            });
            let startupError;
            server.once("error", error => { startupError = error; });
            const deadline = Date.now() + 45_000;
            let ready = false;
            while (!interrupted && Date.now() < deadline) {
                if (startupError) throw startupError;
                if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Local server exited; inspect ${path.join(runDir, "server.log")}`);
                try {
                    // An authenticated API check detects the login-page prerequisite;
                    // a 200 response from the HTML shell alone does not establish readiness.
                    const response = await fetch(`${baseURL}/api/options`, { redirect: "error", signal: AbortSignal.timeout(1500) });
                    ready = response.ok && response.headers.get("content-type")?.includes("application/json");
                    await response.body?.cancel();
                    if (ready) break;
                } catch { /* Startup can legitimately take several seconds. */ }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            if (interrupted) return 130;
            if (!ready) throw new Error(`Local API did not become ready; inspect ${path.join(runDir, "server.log")}`);
        }
        if (interrupted) return 130;
        const args = [ cli, "test", "e2e/readweave.spec.ts", "e2e/readweave_user_lifecycle.spec.ts", "--config", configPath, "--project=server", "--workers=1", "--retries=0", "--update-snapshots=none" ];
        if (grep) args.push("--grep", grep);
        if (listOnly) args.push("--list");
        runner = spawn(process.execPath, args, { cwd: serverDir, env, windowsHide: true, stdio: "inherit" });
        const exitCode = await completion(runner);
        return interrupted ? 130 : exitCode;
    } finally {
        stopOwnedChild(runner);
        stopOwnedChild(server);
        if (logFd !== undefined) closeSync(logFd);
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
    }
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
