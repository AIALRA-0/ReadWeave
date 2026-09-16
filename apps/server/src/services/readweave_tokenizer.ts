import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import resourceDir from "./resource_dir.js";
import { readWeaveEstimatedInputTokens } from "./readweave_budget.js";

let tokenizer: Tokenizer | undefined;
/** Exact public vocabulary encoding plus room for API envelope/version differences.
 * Unknown gateway models keep the explicit conservative estimator, not a false exact count. */
export function readWeavePromptInputTokens(system: string, user: string, model: string): number {
    if (!/^deepseek-(?:v4-(?:flash|pro)|flash)(?:-|$)/u.test(model)) return readWeaveEstimatedInputTokens(system + user);
    if (!tokenizer) {
        const root = join(resourceDir.RESOURCE_DIR, "readweave-tokenizer");
        tokenizer = new Tokenizer(JSON.parse(readFileSync(join(root,"tokenizer.json"),"utf8")),
            JSON.parse(readFileSync(join(root,"tokenizer_config.json"),"utf8")));
    }
    const count = tokenizer.encode(system,{add_special_tokens:false}).ids.length
        + tokenizer.encode(user,{add_special_tokens:false}).ids.length;
    return Math.ceil(count * 1.05) + 256;
}
