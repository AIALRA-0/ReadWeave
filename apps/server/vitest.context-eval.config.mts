import { defineConfig } from "vite";
import base from "./vite.config.mts";

// Explicit opt-in command; never a skipped test in the default unit suite.
export default defineConfig(async env => {
    const config = await (typeof base === "function" ? base(env) : base);
    return { ...config, test: { ...config.test,
        include:["evals/readweave_context.eval.ts"],
        env:{...config.test?.env,READWEAVE_EVAL_CONFIG:process.env.READWEAVE_EVAL_CONFIG ?? ""},
        testTimeout:180_000,
        reporters:["verbose",["junit",{outputFile:"./test-output/context-live.xml"}]]
    }};
});
