import { defineConfig } from "vite";
import base from "./vite.config.mts";

// Explicit runner only. Credentials are evaluated at runtime, never in source.
export default defineConfig(async env => {
    const config = await base(env);
    return { ...config, test: { ...config.test,
        include: ["evals/readweave_open_domain.eval.ts"],
        setupFiles: ["../../scripts/readweave/open-domain-privacy.ts", "./spec/setup.ts"],
        sequence: { setupFiles: "list" as const },
        env: { ...config.test.env,
            READWEAVE_OPEN_DOMAIN_CONFIG: process.env.READWEAVE_OPEN_DOMAIN_CONFIG ?? "",
            READWEAVE_OPEN_DOMAIN_RUN: process.env.READWEAVE_OPEN_DOMAIN_RUN ?? "",
            READWEAVE_PRINT_LIVE_BODY: "", READWEAVE_PRINT_REJECTED_BODY: "" },
        silent: true, reporters: ["dot"], maxWorkers: 1,
        testTimeout: 24 * 60 * 60 * 1000,
        coverage: { enabled: false }
    }};
});
