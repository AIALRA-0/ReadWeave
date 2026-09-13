import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import resourceDir from "./resource_dir.js";

/** Complete skill entry and core references, identical across requests for prompt-cache reuse. */
const CORE_WRITING_FILES = [
    "SKILL.md",
    "references/format-rules.md",
    "references/explanation-framework.md"
] as const;

const cached = new Map<boolean, { prompt: string; revision: string }>();

export function readWeaveWritingSkill(includeFormula = true): { prompt: string; revision: string } {
    const existing = cached.get(includeFormula);
    if (existing) return existing;
    const root = join(resourceDir.RESOURCE_DIR, "readweave-writing-skill");
    const files = [ ...CORE_WRITING_FILES,
        ...(includeFormula ? [ "references/formula-explanation.md" ] : []) ];
    const documents = files.map(file => ({ file, text: readFileSync(join(root, file), "utf8") }));
    const revision = createHash("sha256")
        .update(documents.map(({ file, text }) => `${file}\n${text}`).join("\n"))
        .digest("hex");
    const result = {
        revision,
        prompt: [
            "以下是完整的中文写作技能入口及本题所需的完整核心规则，均为写作指令而非文章来源；按入口的适用条件执行，不把开发或本地文件操作当作运行时任务",
            ...documents.map(({ file, text }) => `【${file}】\n${text}`)
        ].join("\n\n")
    };
    cached.set(includeFormula, result);
    return result;
}
