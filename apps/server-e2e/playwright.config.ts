import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';

// For CI, you may want to set BASE_URL to the deployed application.
const port = process.env['TRILIUM_PORT'] ?? "8082";
const baseURL = process.env['BASE_URL'] || `http://127.0.0.1:${port}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: "src",
    reporter: [["list"], ["html", { outputFolder: "test-output" }]],
    outputDir: "test-output",
    retries: 3,
    // All browser tests share one integration database and server. Running them
    // concurrently can leak tabs and search results between test files on slower CI machines.
    workers: process.env.CI ? 1 : undefined,

    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        baseURL,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Run your local dev server before starting the tests */
    webServer: !process.env.TRILIUM_DOCKER ? {
        command: 'pnpm build && cross-env TRILIUM_ENV=production node dist/main.cjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        cwd: join(__dirname, "../server"),
        env: {
            TRILIUM_DATA_DIR: "spec/db",
            TRILIUM_PORT: port,
            TRILIUM_INTEGRATION_TEST: "memory",
            READWEAVE_TEST_AI: "mock"
        },
        timeout: 5 * 60 * 1000
    } : undefined,

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        }
    ]
});
