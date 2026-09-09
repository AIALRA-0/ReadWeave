import { Lexer } from "marked";

export const READWEAVE_FORMAT_VERSION = "format-2026-09-v1";

function normalizeSimpleMathNotation(value: string): string {
    const scientific = new RegExp(
        String.raw`(?<![\p{L}\p{N}$])(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*`
        + String.raw`([+-]?\d+)(?![\p{L}\p{N}])`, "gu"
    );
    const inequality = new RegExp(
        String.raw`(?<![\p{L}\p{N}$])([A-Za-z])\s*(>=|<=|!=)\s*`
        + String.raw`(-?\d+(?:\.\d+)?)(?![\p{L}\p{N}])`, "gu"
    );
    return value
        .split(/(\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$)/u)
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return part
                .replace(
                    scientific,
                    (_match, coefficient: string, exponent: string) =>
                        `$${coefficient} \\times 10^{${exponent}}$`
                )
                .replace(
                    /(?<![\p{L}\p{N}$])10\s*\^\s*([+-]?\d+)(?![\p{L}\p{N}])/gu,
                    (_match, exponent: string) => `$10^{${exponent}}$`
                )
                .replace(
                    inequality,
                    (_match, variable: string, operator: string, operand: string) => {
                        const latexOperator =
                            operator === ">=" ? "\\geq" : operator === "<=" ? "\\leq" : "\\neq";
                        return `$${variable} ${latexOperator} ${operand}$`;
                    }
                );
        })
        .join("");
}

// These are opaque data, not Chinese prose. Block code, tables and quotations
// are handled by the Markdown lexer; this pattern protects inline data.
const INLINE_DATA = new RegExp([
    "(`+[^`\\n]*`+|",
    String.raw`\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|`,
    String.raw`!?\[[^\]\n]*\]\([^\n]*?\)|https?:\/\/[^\s<>，；。]+|`,
    String.raw`(?:[A-Za-z]:[\\/]|(?:\.{0,2})\/)[^\s，；。]+|[“「『][^”」』\n]*[”」』])`
].join(""), "gu");

export function mapReadWeaveProse(body: string, transform: (text: string) => string): string {
    return Lexer.lex(body)
        .map((token) => {
            if ([ "code", "table", "blockquote", "html" ].includes(token.type)) return token.raw;
            return token.raw
                .split(INLINE_DATA)
                .map((part, index) => (index % 2 ? part : transform(part)))
                .join("");
        })
        .join("");
}

/** Group only explicit, adjacent bilingual definitions, never infer a list from prose. */
function groupBilingualDefinitions(body: string): string {
    const tokens = Lexer.lex(body);
    const label = /^[\p{Script=Han}][\p{Script=Han} ]{0,49}（[A-Za-z][A-Za-z -]{0,99}）：/u;
    let group: number[] = [];
    const flush = () => {
        if (group.length >= 3) {
            for (const index of group) tokens[index].raw = `- ${tokens[index].raw}`;
        }
        group = [];
    };
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.type === "space") continue;
        if (token.type === "paragraph" && label.test(token.raw)) {
            group.push(index);
        } else {
            flush();
        }
    }
    flush();
    return tokens.map(token => token.raw).join("");
}

/** FMT-003/008: never rewrite code, URLs, quotations, tables or formulae. */
export function formatReadWeaveMarkdown(value: unknown): string {
    if (typeof value !== "string") return "";
    const fullName = new RegExp(
        String.raw`\b([A-Z][A-Z0-9-]{1,15})\s*的(?:官方|完整|英文|中文)*全称(?:是|为)\s*`
        + String.raw`([A-Za-z][A-Za-z -]{3,100})[（(]([\p{Script=Han}][\p{Script=Han}\s]{1,50})[)）]`,
        "gu"
    );
    const englishFirst = new RegExp(
        String.raw`^([ \t]*(?:[-*+] )?)([A-Za-z][A-Za-z -]{0,99})[（(]`
        + String.raw`([\p{Script=Han}][\p{Script=Han} ]{0,49})[)）][：:]`, "gmu"
    );
    return groupBilingualDefinitions(mapReadWeaveProse(value, (text) =>
        normalizeSimpleMathNotation(text)
            .replace(fullName, "$1 $3（$2）")
            .replace(englishFirst, "$1$3（$2）：")
            .replace(/。(?=[ \t]*(?:\n|$))/gu, "")
            .replace(/。/gu, "；")
            .replace(/；(?=[ \t]*(?:\n|$))/gu, "")
            .replace(/(?<=\p{Script=Han})[ \t]*:[ \t]*/gu, "：")
            .replace(/(?<=\p{Script=Han})[ \t]*,[ \t]*/gu, "，")
            .replace(/,[ \t]*(?=\p{Script=Han})/gu, "，")
            .replace(/(?<=\p{Script=Han})[ \t]*;[ \t]*/gu, "；")
            .replace(/(?<=\p{Script=Han})(?=[A-Za-z0-9])/gu, " ")
            .replace(/(?<=[A-Za-z0-9])(?=\p{Script=Han})/gu, " ")
            .replace(/\n(?:[ \t]*\n){2,}/gu, "\n\n")
            .replace(/^[^\n]+$/gmu, line => {
                const clauses = line.split("；").map(part => part.trim()).filter(Boolean);
                const meaningStart = /^(?:其中\s*)?[A-Za-z][A-Za-z -]{0,40}\s*(?:指|表示|意为|是指)/u;
                const isMeaning = (part: string) => meaningStart.test(part);
                let count = 0;
                while (count < clauses.length && isMeaning(clauses[count])) count++;
                if (count < 3) return line;
                const list = clauses.slice(0, count).map(part => {
                    const pattern = new RegExp(
                        String.raw`^(?:其中\s*)?([A-Za-z][A-Za-z -]{0,40}?)\s*(?:指|表示|意为|是指)\s*`
                        + String.raw`([\p{Script=Han}]{1,12})(?:[，,](.*))?$`, "u"
                    );
                    const meaning = part.match(pattern);
                    const explanation = meaning?.[3] ? `：${meaning[3].trim()}` : "";
                    return meaning
                        ? `- ${meaning[2]}（${meaning[1].trim()}）${explanation}`
                        : `- ${part}`;
                }).join("\n");
                const remainder = count < clauses.length
                    ? `\n\n${clauses.slice(count).join("；")}` : "";
                return list + remainder;
            })
            .replace(
                /^([^\n：（）()]{1,24}：)([^\n：；。]+、[^\n：；。]+、[^\n：；。]+)$/gmu,
                (_all, prefix: string, items: string) =>
                    `${prefix}\n${
                        items
                            .split("、")
                            .map((item) => `  - ${item.trim()}`)
                            .join("\n")}`
            )
            .replace(
                /^([^\n：]{1,24}(?:包括|包含|如下)：)\n([^\n]+(?:\n[^\n]+)+)$/gmu,
                (_all, prefix: string, rows: string) =>
                    rows.split("\n").some((row) => /^\s*(?:[-*+]|\d+[.)])\s/u.test(row))
                        ? _all
                        : `${prefix}\n${
                            rows
                                .split("\n")
                                .map((row) => `  - ${row.trim()}`)
                                .join("\n")}`
            )
    ).trim());
}

export interface ReadWeaveTextPatch {
    start: number;
    original: string;
    replacement: string;
    rule: string;
}

/** A stale or overlapping patch batch is rejected atomically. */
export function applyReadWeaveFormatPatches(body: string, patches: ReadWeaveTextPatch[]): string {
    const ordered = [ ...patches ].sort((a, b) => a.start - b.start);
    let end = 0;
    for (const patch of ordered) {
        if (
            !Number.isInteger(patch.start) ||
            patch.start < end ||
            !patch.original ||
            body.slice(patch.start, patch.start + patch.original.length) !== patch.original
        ) {
            throw new Error("格式补丁与当前正文不一致，未应用修改");
        }
        // A format repair may change layout/punctuation, never lexical facts.
        const words = (value: string) =>
            value.replace(/^[ \t]*[-*+]\s+/gmu, "").replace(/[\s，,；;。:：]/gu, "");
        if (words(patch.original) !== words(patch.replacement))
            throw new Error("格式补丁改变了正文内容，未应用修改");
        const data = (value: string) => mapReadWeaveProse(value, () => "");
        if (data(patch.original) !== data(patch.replacement))
            throw new Error("格式补丁触及原样保护内容，未应用修改");
        end = patch.start + patch.original.length;
    }
    return ordered
        .reverse()
        .reduce(
            (value, patch) =>
                value.slice(0, patch.start) +
                patch.replacement +
                value.slice(patch.start + patch.original.length),
            body
        );
}

export function readWeaveFormatIssues(body: string): string[] {
    const issues = new Set<string>();
    mapReadWeaveProse(body, (text) => {
        if (/。/u.test(text)) issues.add("FMT-009：普通正文仍含中文句号");
        if (/[；。][ \t]*(?:\n|$)/u.test(text)) issues.add("FMT-018：段末标点不符合规则");
        if (/\n(?:[ \t]*\n){2,}/u.test(text)) issues.add("FMT-024：存在多余空白行");
        if (/：[^\n：]+、[^\n：]+、[^\n：]+/u.test(text))
            issues.add("FMT-010：冒号后的三个以上并列项需要分行");
        if (/[\p{Script=Han}][A-Za-z0-9]|[A-Za-z0-9][\p{Script=Han}]/u.test(text))
            issues.add("FMT-013：中文与英文或数字之间缺少空格");
        return text;
    });
    return [ ...issues ];
}

/** Only submit a failing prose line, never the complete answer, for repair. */
export async function repairReadWeaveFormat(
    original: string,
    repair: (fragment: string, issues: string[]) => Promise<string>,
    signal?: AbortSignal,
    maxRounds = 2
): Promise<{ body: string; rounds: number; warnings: string[] }> {
    let body = original;
    let rounds = 0;
    const warnings: string[] = [];
    for (; rounds < Math.min(2, Math.max(0, maxRounds)); ) {
        let fragment: string | undefined;
        mapReadWeaveProse(body, (text) => {
            fragment ??= text
                .split("\n")
                .find((line) => line.length <= 600 && readWeaveFormatIssues(line).length > 0);
            return text;
        });
        if (!fragment) break;
        const start = body.indexOf(fragment);
        if (body.indexOf(fragment, start + fragment.length) >= 0) break;
        signal?.throwIfAborted();
        rounds++;
        try {
            const replacement = await repair(fragment, readWeaveFormatIssues(fragment));
            signal?.throwIfAborted();
            const next = applyReadWeaveFormatPatches(body, [
                { start, original: fragment, replacement, rule: "FMT-local" }
            ]);
            if (next === body) break;
            body = next;
        } catch (error) {
            signal?.throwIfAborted();
            warnings.push(error instanceof Error ? error.message : "局部格式修改未应用");
            break;
        }
    }
    return { body, rounds, warnings };
}
