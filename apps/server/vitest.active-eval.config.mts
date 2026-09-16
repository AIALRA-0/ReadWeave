import { defineConfig } from "vite";
import base from "./vite.config.mts";
export default defineConfig(async env => {
    const config = await (typeof base === "function" ? base(env) : base);
    return { ...config, test: { ...config.test,
        include: ["evals/readweave_active.eval.ts"],
        env: {...config.test?.env, READWEAVE_ACTIVE_PROXY:process.env.READWEAVE_ACTIVE_PROXY ?? "", READWEAVE_ACTIVE_REPORT:process.env.READWEAVE_ACTIVE_REPORT ?? ""},
        testTimeout:600_000, maxWorkers:1,
        reporters:["verbose",["junit",{outputFile:"./test-output/active-live.xml"}]]
    }};
});
