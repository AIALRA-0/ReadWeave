import { defineConfig, devices } from "@playwright/test";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = __dirname;
const repoRoot = resolve(appDir, "../..");
const dataDir = join(repoRoot, ".cache/readweave-auth-e2e");
const port = process.env.TRILIUM_PORT ?? "18084";
const baseURL = `http://127.0.0.1:${port}`;

// Authentication browser tests use a disposable copy inside the repository.
// They never open the developer, production ReadWeave or original Trilium DB.
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
cpSync(
    join(repoRoot, "packages/trilium-core/src/test/fixtures/document.db"),
    join(dataDir, "document.db")
);
writeFileSync(join(dataDir, "config.ini"), `[General]
instanceName=ReadWeave authentication E2E
noAuthentication=false
noBackup=true

[Network]
host=127.0.0.1
port=${port}
https=false
trustedReverseProxy=false

[Session]
cookieMaxAge=86400
`);

process.env.READWEAVE_AUTH_E2E = "1";
process.env.READWEAVE_AUTH_E2E_DATA_DIR = dataDir;

export default defineConfig({
    testDir: join(appDir, "e2e"),
    testMatch: "authentication_expiry.spec.ts",
    workers: 1,
    retries: 0,
    reporter: [["list"]],
    outputDir: join(repoRoot, ".cache/readweave-auth-e2e-output"),
    use: {
        ...devices["Desktop Chrome"],
        baseURL,
        trace: "retain-on-failure"
    },
    webServer: {
        command: "pnpm start-prod-no-dir",
        url: baseURL,
        reuseExistingServer: false,
        cwd: appDir,
        env: {
            TRILIUM_DATA_DIR: dataDir,
            TRILIUM_TMP_DIR: join(dataDir, "tmp"),
            TRILIUM_PORT: port,
            READWEAVE_TEST_AI: "mock"
        },
        timeout: 5 * 60 * 1000
    }
});
