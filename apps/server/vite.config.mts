/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    setupFiles: ["./spec/setup.ts"],
    environment: "node",
    env: {
      NODE_ENV: "development",
      TRILIUM_DATA_DIR: "./spec/db",
      TRILIUM_INTEGRATION_TEST: "memory",
      // Must be set in the vitest env (not in spec/setup.ts) so import-time
      // constants like `isDev` in apps/server/src/services/utils.ts evaluate
      // correctly. setup.ts top-level statements run AFTER its static imports
      // resolve, so any env var assigned there is too late for module-load
      // constants in transitively-imported files.
      TRILIUM_ENV: "dev",
      TRILIUM_PUBLIC_SERVER: "http://localhost:4200",
      // Vitest's explicit env object is isolated from the invoking shell.
      // Forward opt-in live-test settings without storing any credential in
      // source control so a green "live" run cannot silently be a skipped run.
      READWEAVE_LIVE_AI: process.env.READWEAVE_LIVE_AI ?? "",
      READWEAVE_BENCHMARK_AI: process.env.READWEAVE_BENCHMARK_AI ?? "",
      READWEAVE_BENCHMARK_REPETITIONS: process.env.READWEAVE_BENCHMARK_REPETITIONS ?? "",
      READWEAVE_BENCHMARK_FILTER: process.env.READWEAVE_BENCHMARK_FILTER ?? "",
      READWEAVE_BENCHMARK_SEARCH: process.env.READWEAVE_BENCHMARK_SEARCH ?? "",
      READWEAVE_BENCHMARK_CONCURRENCY: process.env.READWEAVE_BENCHMARK_CONCURRENCY ?? "",
      READWEAVE_PRINT_LIVE_BODY: process.env.READWEAVE_PRINT_LIVE_BODY ?? "",
      READWEAVE_PRINT_REJECTED_BODY: process.env.READWEAVE_PRINT_REJECTED_BODY ?? "",
      READWEAVE_DEEPSEEK_API_KEY: process.env.READWEAVE_DEEPSEEK_API_KEY ?? "",
      READWEAVE_API_BASE_URL: process.env.READWEAVE_API_BASE_URL ?? "",
      READWEAVE_DEEPSEEK_MODEL: process.env.READWEAVE_DEEPSEEK_MODEL ?? "",
      SERPER_API_KEY: process.env.SERPER_API_KEY ?? "",
      TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? "",
      BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY ?? "",
      JINA_API_KEY: process.env.JINA_API_KEY ?? "",
      SEMANTIC_SCHOLAR_API_KEY: process.env.SEMANTIC_SCHOLAR_API_KEY ?? "",
      OPENALEX_API_KEY: process.env.OPENALEX_API_KEY ?? "",
      UNPAYWALL_EMAIL: process.env.UNPAYWALL_EMAIL ?? ""
    },
    include: [
      '{src,spec}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../packages/trilium-core/src/**/*.{test,spec}.{ts,tsx}'
    ],
    exclude: [
      "spec/build-checks/**",
    ],
    hookTimeout: 20_000,
    testTimeout: 40_000,
    reporters: [
      "verbose",
      ["html", { outputFile: "./test-output/vitest/html/index.html" }],
      ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
    ],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      reporter: [ "text", "html", "lcov" ],
      allowExternal: true,
      include: ["src/**/*.{ts,tsx}", "../../packages/trilium-core/src/**/*.{ts,tsx}"],
      exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"]
    },
    pool: "forks",
    maxWorkers: 6
  },
}));
