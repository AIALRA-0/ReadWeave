import { Lexer } from "marked";

export const READWEAVE_FORMAT_VERSION = "format-2026-09-v3";

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

function readWeaveProseRanges(body: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const token of Lexer.lex(body)) {
        const tokenStart = body.indexOf(token.raw, cursor);
        if (tokenStart < 0) continue;
        cursor = tokenStart + token.raw.length;
        if ([ "code", "table", "blockquote", "html" ].includes(token.type)) continue;
        let partCursor = 0;
        for (const [ index, part ] of token.raw.split(INLINE_DATA).entries()) {
            const partStart = token.raw.indexOf(part, partCursor);
            if (partStart < 0) continue;
            partCursor = partStart + part.length;
            if (index % 2 === 0 && part) {
                ranges.push({ start: tokenStart + partStart, end: tokenStart + partStart + part.length });
            }
        }
    }
    return ranges;
}

const LATIN_PERSON_NAME = /^(?:[A-Z](?:\.|[A-Za-z'’.-]+))(?:\s+(?:(?:van|von|de|da|del|di|la|le|du|der|den|ten|ter)\s+)?[A-Z](?:\.|[A-Za-z'’.-]+)){1,5}$/u;

/** Keep a person's Chinese name outside the parentheses when both names exist. */
export function formatReadWeavePersonNameOrder(body: string, subject: string): string {
    const normalizedSubject = subject.normalize("NFKC").trim();
    const subjectPair = normalizedSubject.match(/^(.+?)[（(]([^)）]+)[）)]$/u);
    const subjectLatin = subjectPair
        ? [ subjectPair[1].trim(), subjectPair[2].trim() ].find(part => LATIN_PERSON_NAME.test(part))
        : LATIN_PERSON_NAME.test(normalizedSubject) ? normalizedSubject : undefined;
    if (!subjectLatin) return body;
    const escaped = subjectLatin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const reversed = new RegExp(
        `(?<![\\p{Script=Latin}\\p{N}_])(${escaped})\\s*[（(]\\s*`
        + "([\\p{Script=Han}]{2,4}(?:·[\\p{Script=Han}]{1,8})?)"
        + "(?:\\s*[，,]\\s*[A-Za-z.'’ -]{1,40}为姓)?\\s*[）)]",
        "giu"
    );
    const chineseFirst = new RegExp(
        `([\\p{Script=Han}]{2,4}(?:·[\\p{Script=Han}]{1,8})?)\\s*[（(]\\s*(${escaped})`
        + "(?:\\s*[，,]\\s*[A-Za-z.'’ -]{1,40}为姓)?\\s*[）)]",
        "giu"
    );
    return mapReadWeaveProse(body, text => text
        .replace(reversed, (_match, englishName: string, chineseName: string) =>
            `${chineseName}（${englishName}）`)
        .replace(chineseFirst, (_match, chineseName: string, englishName: string) =>
            `${chineseName}（${englishName}）`));
}

const TRAILING_ACRONYM_NAME = new RegExp(
    String.raw`((?:[A-Z][A-Za-z'’.-]*[ \t]+){0,4}[\p{Script=Han}]{2,30})[ \t]*[（(]`
    + String.raw`([A-Za-z][A-Za-z'’.-]*(?:[ \t-]+[A-Za-z][A-Za-z'’.-]*){1,12})`
    + String.raw`[ \t]*[，,][ \t]*([A-Z][A-Z0-9+/#_-]{1,15})[）)]`, "gu"
);

function englishInitials(value: string): string {
    return value.split(/[ -]/u)
        .filter(word => word && !/^(?:of|the|and|for)$/iu.test(word))
        .map(word => word[0]).join("").toUpperCase();
}

/** Reorder names whose complete fields are already present. No model knowledge
 * or lexical content is introduced by this operation. */
export function formatReadWeaveCanonicalEntities(body: string): string {
    return mapReadWeaveProse(body, text => text.replace(
        TRAILING_ACRONYM_NAME,
        (original, rawLabel: string, englishName: string, abbreviation: string) => {
            if (englishInitials(englishName) !== abbreviation) return original;
            const sentence = /^[A-Z]/u.test(rawLabel) ? undefined : rawLabel.match(
                /^(.*?(?:属于|涉及|采用|使用|通过|基于|面向|以及|和|与|是|为))([\p{Script=Han}]{2,30})$/u
            );
            const connector = sentence?.[1] ?? "";
            const label = sentence?.[2] ?? rawLabel;
            if (!label || !/\p{Script=Han}/u.test(label)) return original;
            return `${connector}${connector ? " " : ""}${abbreviation} ${label}（${englishName}）`;
        }
    ));
}

/** Keep generated headings visually and semantically local to the side panel. */
export function formatReadWeaveAnswerHeadings(body: string, enabled = true): string {
    if (!enabled) return body;
    const headings = Array.from(body.matchAll(/^ {0,3}#{1,6}[ \t]+\S.*$/gmu));
    if (!headings.length) return body;
    let normalized = body.replace(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu, "### $1");
    const firstHeading = normalized.search(/^###\s+/mu);
    if (firstHeading > 0 && normalized.slice(0, firstHeading).trim()) {
        normalized = `### 回答\n\n${normalized}`;
    }
    return normalized;
}

/** Mark explicit bilingual definitions; never infer a definition from prose. */
function groupBilingualDefinitions(body: string): string {
    const tokens = Lexer.lex(body);
    const label = new RegExp("^(?:[A-Z][A-Z0-9.-]* )?"
        + "[\\p{Script=Han}][\\p{Script=Han} ]{0,49}（[A-Za-z][A-Za-z -]{0,99}）：", "u");
    let group: number[] = [];
    const flush = () => {
        if (group.length >= 1) {
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

/** Align only a later annotated copy whose statements match an earlier block exactly. */
export function formatReadWeaveCodeCopies(body: string, sourceBlocks: string[] = []): string {
    const tokens = Lexer.lex(body);
    const originals = sourceBlocks.flatMap(source => Lexer.lex(source)
        .flatMap(token => token.type === "code"
            ? [ { lang: token.lang ?? "", lines: token.text.split("\n"), raw: token.raw } ] : []));
    for (const token of tokens) {
        if (token.type !== "code") continue;
        const lang = token.lang ?? "";
        const marker = /^(?:python|py)$/u.test(lang) ? "#"
            : /^(?:javascript|js|typescript|ts)$/u.test(lang) ? "//" : undefined;
        if (!marker) continue;
        const lines = token.text.split("\n");
        for (const original of originals.filter(item => item.lang === lang)) {
            if (original.lines.length !== lines.length) continue;
            const comments = lines.map((line, index) => {
                const statement = original.lines[index].trimEnd();
                if (!statement || !line.startsWith(statement)) return undefined;
                const tail = line.slice(statement.length);
                return /^\s/u.test(tail) && tail.trimStart().startsWith(marker)
                    ? tail.trimStart() : undefined;
            });
            if (comments.some(comment => comment === undefined)) continue;
            const width = (line: string) => Array.from(line.trimEnd())
                .reduce((size, char) => size + (char === "\t" ? 4 : 1), 0);
            const column = Math.max(...original.lines.map(width)) + 2;
            const aligned = original.lines.map((line, index) => line.trimEnd()
                + " ".repeat(column - width(line)) + comments[index]).join("\n");
            token.raw = token.raw.replace(token.text, aligned);
            if (!tokens.some(item => item.type === "code" && item.lang === lang
                && item.text === original.lines.join("\n"))) {
                token.raw = original.raw.trimEnd() + "\n\n" + token.raw;
            }
            break;
        }
        originals.push({ lang, lines, raw: token.raw });
    }
    return tokens.map(token => token.raw).join("");
}

/** Only merge plain prose for the explicit definition task, never mixed-media blocks. */
export function formatReadWeaveDefinitionBlock(body: string): string {
    const tokens = Lexer.lex(body).filter(token => token.type !== "space");
    const first = tokens[0];
    if (first?.type !== "list" || first.items.length !== 1
        || first.items[0].tokens.some(token => ![ "text", "space" ].includes(token.type))
        || tokens.slice(1).some(token => token.type !== "paragraph")
        || mapReadWeaveProse(body, () => "").trim()) return body;
    return body.split(/\n\s*\n/u).map(part => part.trim()).join("；");
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
    return formatReadWeaveCodeCopies(groupBilingualDefinitions(mapReadWeaveProse(value, (text) =>
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
            .replace(
                /^([\p{Script=Han}][\p{Script=Han} ]{1,19})：[ \t]*(?=\n[ \t]*\n|(?![\s\S]))/gmu,
                "## $1"
            )
            .replace(/^[^\n]+$/gmu, line => {
                const clauses = line.split("；").map(part => part.trim()).filter(Boolean);
                const meaningStart = /^(?:其中\s*)?[A-Za-z][A-Za-z -]{0,40}\s*(?:指|表示|意为|是指)/u;
                const isMeaning = (part: string) => meaningStart.test(part);
                let count = 0;
                while (count < clauses.length && isMeaning(clauses[count])) count++;
                if (count < 2) return line;
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
                /^([^\n：（）()]{1,24}：)([^\n：；。]+、[^\n：；。]+)$/gmu,
                (_all, prefix: string, items: string) =>
                    isExplicitShortEnumeration(items)
                        ? `${prefix}\n${items.split("、")
                            .map(item => `  - ${item.trim()}`).join("\n")}`
                        : _all
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
    ).trim()));
}

export interface ReadWeaveTextPatch {
    start: number;
    original: string;
    replacement: string;
    rule: string;
}

/** Only short, explicit labels are safe to split without semantic rewriting. */
function isExplicitShortEnumeration(value: string): boolean {
    const items = value.split("、");
    return items.length >= 2 && items.every(item => item.trim().length <= 16
        && !/[，,；;。！？!?]|(?:是|用于|用来|使得|从而|因此|不是|不能)/u.test(item));
}

/** Render an already-sourced full name using the writer's separate Chinese
 * identity, without changing names or expanding the answer into a definition. */
export function formatReadWeaveFullNameOpening(body: string, chineseName?: string): string {
    if (!chineseName || !/^[\p{Script=Han}][\p{Script=Han} ]{1,49}$/u.test(chineseName))
        return body;
    const opening = body.split(/\n{2,}/u)[0];
    const match = opening.match(new RegExp(
        "^([A-Z][A-Z0-9-]{1,15})\\s*的(?:官方|正式|完整|英文|中文)*全称(?:是|为)\\s*"
        + "([A-Za-z][A-Za-z &/-]{2,199}?)[。；;]?$", "u"
    ));
    if (!match) return body;
    return `${match[1]} ${chineseName}（${match[2].trim()}）${body.slice(opening.length)}`;
}

/** Keep one canonical term label and use its Chinese name for later prose references. */
export function formatReadWeaveTermReferences(
    body: string,
    identity?: { abbreviation?: string; chineseName?: string; englishName?: string }
): string {
    const abbreviation = identity?.abbreviation?.trim();
    const chineseName = identity?.chineseName?.trim();
    const englishName = identity?.englishName?.trim();
    if (!abbreviation || !chineseName || !englishName) return body;
    const escapedToken = abbreviation.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const escapedChinese = chineseName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const escapedEnglish = englishName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const canonicalSource = `${escapedToken}\\s+${escapedChinese}（${escapedEnglish}）`;
    const tokenSource = `(?<![\\p{Script=Latin}\\p{N}_.])${escapedToken}(?![\\p{Script=Latin}\\p{N}_])`;
    const reference = new RegExp(
        `${canonicalSource}|${tokenSource}[ \\t]*(?=[\\p{Script=Han}，；。：、！？])|${tokenSource}`,
        "gu"
    );
    let keptCanonical = false;
    return mapReadWeaveProse(body, prose => prose.replace(reference, value => {
        if (new RegExp(`^${canonicalSource}$`, "u").test(value)) {
            if (!keptCanonical) {
                keptCanonical = true;
                return value;
            }
            return chineseName;
        }
        return keptCanonical ? chineseName : value.trimEnd();
    }).replace(
        new RegExp(`([\\p{Script=Han}，；。：、！？])[ \\t]+(?=${escapedChinese})`, "gu"),
        "$1"
    ));
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
    if (formatReadWeaveCanonicalEntities(body) !== body)
        issues.add("FMT-052：缩写必须置于中文全称和英文全称之前");
    if (/^ {0,3}(?:#{1,2}|#{4,6})[ \t]+\S/gmu.test(body))
        issues.add("FMT-023：回答小标题必须使用统一层级");
    const firstHeading = body.search(/^ {0,3}#{1,6}[ \t]+\S/mu);
    if (firstHeading > 0 && body.slice(0, firstHeading).trim())
        issues.add("FMT-023：分区回答的首段缺少小标题");
    mapReadWeaveProse(body, (text) => {
        if (/。/u.test(text)) issues.add("FMT-009：普通正文仍含中文句号");
        if (/[；。][ \t]*(?:\n|$)/u.test(text)) issues.add("FMT-018：段末标点不符合规则");
        if (/\n(?:[ \t]*\n){2,}/u.test(text)) issues.add("FMT-024：存在多余空白行");
        const definitionOpening = /^\s*(?:[-*]\s+)?(?:[A-Z][A-Z0-9.-]*\s+)?[\p{Script=Han}][^：\n]{0,100}（[^（）\n]+）：/u;
        if (text.split("\n").some(line => !definitionOpening.test(line)
            && isExplicitShortEnumeration(line.match(/^[^：\n]{1,24}：([^：\n]+)$/u)?.[1] ?? "")))
            issues.add("FMT-036：冒号后的两个以上独立并列项需要分行");
        if (/[\p{Script=Han}][A-Za-z0-9]|[A-Za-z0-9][\p{Script=Han}]/u.test(text))
            issues.add("FMT-047：中文与英文或数字之间缺少空格");
        if (/(?<![\p{Script=Latin}\p{N}_])[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,5}\s*[（(]\s*[\p{Script=Han}]{2,4}(?:·[\p{Script=Han}]{1,8})?(?:\s*[，,][^）)]{1,40})?\s*[）)]/u.test(text))
            issues.add("FMT-044：人物姓名顺序必须为中文姓名（English or Pinyin Name）");
        return text;
    });
    return [ ...issues ];
}

interface OptionalQualifier {
    token: string;
    fragment: string;
    before: string;
    after: string;
}

/** Only a redundant, unrequested qualifier can be omitted. The model cannot
 * add an expansion or return rewritten prose through this interface. */
export async function repairReadWeaveOptionalQualifiers(
    original: string, question: string,
    approve: (targets: OptionalQualifier[]) => Promise<unknown>,
    signal?: AbortSignal
) {
    const targets: Array<OptionalQualifier & { start: number }> = [];
    mapReadWeaveProse(original, prose => {
        for (const match of prose.matchAll(/\b([A-Z]{2,8})\b/gu)) {
            const token = match[1];
            const start = original.indexOf(token);
            const prefix = original.slice(0, start);
            const after = original.slice(start + token.length, start + token.length + 100);
            const parenthetical = /[\p{Script=Han}]（$/u.test(prefix) && after.startsWith("）")
                || /[\p{Script=Han}]\($/u.test(prefix) && after.startsWith(")");
            if (!parenthetical && !/^[ \t]*[\p{Script=Han}]{2}/u.test(after)) continue;
            if (question.includes(token) || start !== original.lastIndexOf(token)
                || prefix.lastIndexOf("《") > prefix.lastIndexOf("》")
                || /^\s*[和与及或的是为不无]/u.test(after)
                || /^\s*[\p{Script=Han}]{2,40}（[A-Za-z]/u.test(after)) continue;
            const fragment = parenthetical ? `${prefix.at(-1)}${token}${after[0]}` : token;
            const fragmentStart = parenthetical ? start - 1 : start;
            const end = fragmentStart + fragment.length;
            targets.push({ token, fragment, start:fragmentStart,
                before:original.slice(Math.max(0, fragmentStart - 100), fragmentStart),
                after:original.slice(end, end + 100) });
        }
        return prose;
    });
    if (!targets.length) return { body:original, rounds:0, warnings:[] as string[] };
    signal?.throwIfAborted();
    try {
        const chosen = targets.slice(0, 2);
        const result = await approve(chosen.map(({ token, fragment, before, after }) =>
            ({ token, fragment, before, after })));
        signal?.throwIfAborted();
        if (!Array.isArray(result)) throw new Error("局部简称检查未返回有效决定");
        let body = original;
        for (const target of chosen.toSorted((a, b) => b.start - a.start)) {
            const decision = result.filter(item => item?.token === target.token);
            if (decision.length !== 1 || decision[0].omit !== true
                || typeof decision[0].reason !== "string" || decision[0].reason.trim().length < 4)
                continue;
            let before = body.slice(0, target.start);
            const after = body.slice(target.start + target.fragment.length).replace(/^[ \t]+/u, "");
            if (/\p{Script=Han}[ \t]+$/u.test(before) && /^\p{Script=Han}/u.test(after))
                before = before.replace(/[ \t]+$/u, "");
            body = before + after;
        }
        return { body, rounds:1, warnings:[] as string[] };
    } catch (error) {
        signal?.throwIfAborted();
        return { body:original, rounds:1,
            warnings:[ error instanceof Error ? error.message : "局部简称检查未应用" ] };
    }
}

/** Annotate an incidental conventional initialism, never invent a project's
 * etymology or rewrite a sentence. Model knowledge is not a source quotation. */
export async function repairReadWeaveConventionalTerms(
    original: string, question: string,
    resolve: (targets: Array<{ token:string;before:string;after:string }>) => Promise<unknown>,
    signal?: AbortSignal
) {
    original = formatReadWeaveCanonicalEntities(original);
    const occurrences = readWeaveProseRanges(original).flatMap(range => Array.from(
        original.slice(range.start, range.end)
            .matchAll(/(?<![\p{Script=Latin}\p{N}_.])(?:[A-Z][A-Z0-9+/#_-]{1,15}(?:\.[A-Za-z0-9]+)?|dB|SoC|NoC|IPv[46])(?![\p{Script=Latin}\p{N}_])/gu),
        match => ({ token: match[0], start: range.start + (match.index ?? 0), rangeStart: range.start })
    ));
    const firstByToken = new Map<string, { token:string;start:number;before:string;after:string }>();
    for (const occurrence of occurrences) {
        if (firstByToken.has(occurrence.token)) continue;
        const before = original.slice(Math.max(0, occurrence.start - 150), occurrence.start);
        const after = original.slice(occurrence.start + occurrence.token.length, occurrence.start + occurrence.token.length + 150);
        if (before.lastIndexOf("《") > before.lastIndexOf("》")) continue;
        const proseBefore = original.slice(occurrence.rangeStart, occurrence.start);
        const openParenthesis = Math.max(proseBefore.lastIndexOf("（"), proseBefore.lastIndexOf("("))
            > Math.max(proseBefore.lastIndexOf("）"), proseBefore.lastIndexOf(")"));
        const reversedShortLabel = /[\p{Script=Han}]{2,40}（$/u.test(before) && after.startsWith("）");
        if (openParenthesis && !reversedShortLabel) continue;
        const canonical = new RegExp(
            `^\\s+[\\p{Script=Han}][^（）()\\n]{1,120}（[^（）\\n]{1,220}[A-Za-z][^（）\\n]*）`, "u"
        );
        if (canonical.test(after)) continue;
        firstByToken.set(occurrence.token, { ...occurrence, before, after });
    }
    const targets = [ ...firstByToken.values() ];
    if (!targets.length) return {
        body:original,rounds:0,knowledgeTerms:[] as string[],warnings:[] as string[]
    };
    signal?.throwIfAborted();
    const result = await resolve(targets.map(({ token,before,after })=>({ token,before,after })));
    signal?.throwIfAborted();
    let body = original;
    const knowledgeTerms: string[] = [];
    const warnings: string[] = [];
    if (!Array.isArray(result)) warnings.push("局部术语响应缺少 terms 数组，未应用");
    const patches: Array<{ start:number; original:string; replacement:string }> = [];
    if (Array.isArray(result)) for (const target of targets) {
        const matches = result.filter(item=>item?.token === target.token);
        if (matches.length !== 1) {
            warnings.push(`${target.token}：局部术语响应缺项或重复，未应用`);
            continue;
        }
        const term = { ...matches[0] };
        // Trim field boundaries, but never rewrite the supplied names or infer expansions.
        for (const key of [ "chineseName", "englishName", "contextReason" ])
            if (typeof term[key] === "string") term[key] = term[key].trim();
        if (term.confidence !== "high" || term.basis !== "established-usage"
            || typeof term.contextReason !== "string" || !term.contextReason
            || typeof term.chineseName !== "string"
            || !/^[\p{Script=Han}]{2,24}$/u.test(term.chineseName)
            || typeof term.englishName !== "string"
            || !/^[A-Za-z]+(?:[ -][A-Za-z]+){1,7}$/u.test(term.englishName)) {
            warnings.push(`${target.token}：局部术语置信度、用法说明或名称格式不符合约定，未应用`);
            continue;
        }
        const initials = term.englishName.split(/[ -]/u)
            .filter((word:string)=>!/^(?:of|the|and|for)$/iu.test(word))
            .map((word:string)=>word[0]).join("").toUpperCase();
        if (initials !== target.token) {
            warnings.push(`${target.token}：英文名称首字母与缩写不匹配，未应用`);
            continue;
        }
        const annotation = `${target.token} ${term.chineseName}（${term.englishName}）`;
        const tokenOccurrences = occurrences.filter(item => item.token === target.token);
        tokenOccurrences.forEach((occurrence, index) => {
            const before = original.slice(0, occurrence.start);
            const after = original.slice(occurrence.start + target.token.length);
            const reversed = before.match(/([\p{Script=Han}]{2,40})（$/u);
            if (reversed && after.startsWith("）")) {
                const start = occurrence.start - reversed[0].length;
                patches.push({
                    start,
                    original: `${reversed[1]}（${target.token}）`,
                    replacement: annotation
                });
                return;
            }
            const proseBefore = original.slice(occurrence.rangeStart, occurrence.start);
            if (Math.max(proseBefore.lastIndexOf("（"), proseBefore.lastIndexOf("("))
                > Math.max(proseBefore.lastIndexOf("）"), proseBefore.lastIndexOf(")"))) return;
            const spacing = after.match(/^[ \t]+(?=[\p{Script=Han}，；。：、！？])/u)?.[0] ?? "";
            const leading = index > 0
                ? before.match(/(?<=[\p{Script=Han}，；。：、！？])[ \t]+$/u)?.[0] ?? ""
                : "";
            patches.push({
                start: occurrence.start - leading.length,
                original: leading + target.token + spacing,
                replacement: index === 0 ? annotation : term.chineseName
            });
        });
        knowledgeTerms.push(target.token);
    }
    for (const patch of patches.toSorted((a,b)=>b.start-a.start)) {
        if (body.slice(patch.start, patch.start + patch.original.length) !== patch.original) {
            warnings.push(`${patch.original}：局部术语位置已经变化，未应用`);
            continue;
        }
        body = body.slice(0, patch.start) + patch.replacement
            + body.slice(patch.start + patch.original.length);
    }
    return { body,rounds:1,knowledgeTerms,warnings };
}

/** Only submit a failing prose line, never the complete answer, for repair. */
export async function repairReadWeaveFormat(
    original: string,
    repair: (fragment: string, issues: string[]) => Promise<string>,
    signal?: AbortSignal,
    maxRounds = 6
): Promise<{ body: string; rounds: number; warnings: string[] }> {
    let body = original;
    let rounds = 0;
    const warnings: string[] = [];
    for (; rounds < Math.min(6, Math.max(0, maxRounds)); ) {
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
