import { Lexer } from "marked";

export const READWEAVE_FORMAT_VERSION = "format-2026-09-v1";

function normalizeSimpleMathNotation(value: string): string {
    return value
        .split(/(\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$)/u)
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return part
                .replace(
                    /(?<![\p{L}\p{N}$])(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*([+-]?\d+)(?![\p{L}\p{N}])/gu,
                    (_match, coefficient: string, exponent: string) =>
                        `$${coefficient} \\times 10^{${exponent}}$`,
                )
                .replace(
                    /(?<![\p{L}\p{N}$])10\s*\^\s*([+-]?\d+)(?![\p{L}\p{N}])/gu,
                    (_match, exponent: string) => `$10^{${exponent}}$`,
                )
                .replace(
                    /(?<![\p{L}\p{N}$])([A-Za-z])\s*(>=|<=|!=)\s*(-?\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu,
                    (_match, variable: string, operator: string, operand: string) => {
                        const latexOperator =
                            operator === ">=" ? "\\geq" : operator === "<=" ? "\\leq" : "\\neq";
                        return `$${variable} ${latexOperator} ${operand}$`;
                    },
                );
        })
        .join("");
}

// These are opaque data, not Chinese prose. Block code, tables and quotations
// are handled by the Markdown lexer; this pattern protects inline data.
const INLINE_DATA =
    /(`+[^`\n]*`+|\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|!?\[[^\]\n]*\]\([^\n]*?\)|https?:\/\/[^\s<>，；。]+|(?:[A-Za-z]:[\\/]|(?:\.{0,2})\/)[^\s，；。]+|[“「『][^”」』\n]*[”」』])/gu;

export function mapReadWeaveProse(body: string, transform: (text: string) => string): string {
    return Lexer.lex(body)
        .map((token) => {
            if (["code", "table", "blockquote", "html"].includes(token.type)) return token.raw;
            return token.raw
                .split(INLINE_DATA)
                .map((part, index) => (index % 2 ? part : transform(part)))
                .join("");
        })
        .join("");
}

/** FMT-003/008: never rewrite code, URLs, quotations, tables or formulae. */
export function formatReadWeaveMarkdown(value: unknown): string {
    if (typeof value !== "string") return "";
    return mapReadWeaveProse(value, (text) =>
        normalizeSimpleMathNotation(text)
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
            .replace(
                /^([^\n：（）()]{1,24}：)([^\n：；。]+、[^\n：；。]+、[^\n：；。]+)$/gmu,
                (_all, prefix: string, items: string) =>
                    `${prefix}\n${
                        items
                            .split("、")
                            .map((item) => `  - ${item.trim()}`)
                            .join("\n")}`,
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
                                .join("\n")}`,
            ),
    ).trim();
}

export interface ReadWeaveTextPatch {
    start: number;
    original: string;
    replacement: string;
    rule: string;
}

/** A stale or overlapping patch batch is rejected atomically. */
export function applyReadWeaveFormatPatches(body: string, patches: ReadWeaveTextPatch[]): string {
    const ordered = [...patches].sort((a, b) => a.start - b.start);
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
            body,
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
    return [...issues];
}

/** Only submit a failing prose line, never the complete answer, for repair. */
export async function repairReadWeaveFormat(
    original: string,
    repair: (fragment: string, issues: string[]) => Promise<string>,
    signal?: AbortSignal,
): Promise<{ body: string; rounds: number; warnings: string[] }> {
    let body = original;
    let rounds = 0;
    const warnings: string[] = [];
    for (; rounds < 2; ) {
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
                { start, original: fragment, replacement, rule: "FMT-local" },
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
