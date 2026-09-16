/** A provider returned text, but its machine-readable envelope needs repair.
 * The original text is private recovery state, never part of the user error. */
export class ReadWeaveProtocolError extends Error {
    readonly failureClass = "format";
    constructor(readonly rawText: string, detail: string) {
        super(`模型返回结构需要修复：${detail}`);
        this.name = "ReadWeaveProtocolError";
    }
}

/** Extract exactly one complete JSON value. Never choose among multiple objects,
 * invent missing values or trim a partial answer to make parsing succeed. */
export function parseReadWeaveProtocol<T>(content: string): T {
    const clean = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
    try { return JSON.parse(clean) as T; } catch { /* Inspect explicit framing below. */ }
    let start = -1, quoted = false, escaped = false;
    const stack: string[] = [], values: unknown[] = [];
    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (start < 0) {
            if (c !== "{" && c !== "[") continue;
            start = i;
            stack.push(c);
            continue;
        }
        if (quoted) {
            if (escaped) escaped = false;
            else if (c === "\\") escaped = true;
            else if (c === '"') quoted = false;
            continue;
        }
        if (c === '"') { quoted = true; continue; }
        if (c === "{" || c === "[") stack.push(c);
        if (c === "}" || c === "]") {
            if (stack.pop() !== (c === "}" ? "{" : "[")) throw new ReadWeaveProtocolError(content, "括号结构不匹配");
            if (!stack.length) {
                try { values.push(JSON.parse(clean.slice(start, i + 1))); }
                catch { throw new ReadWeaveProtocolError(content, "字段分隔、引号或转义不合法"); }
                start = -1;
            }
        }
    }
    if (start >= 0) throw new ReadWeaveProtocolError(content, "结构尚未闭合");
    if (values.length === 1) return values[0] as T;
    throw new ReadWeaveProtocolError(content, values.length ? "包含多个结果，需要明确唯一结果" : "没有完整结构化结果");
}
