import type {
    ReadWeaveCandidate,
    ReadWeaveContextDecision,
    ReadWeaveContextFragment,
    ReadWeaveObject,
    ReadWeaveObjectKind,
    ReadWeaveTermIdentity
} from "@triliumnext/commons";

const ROLE_WEIGHT: Record<ReadWeaveContextFragment["role"], number> = {
    selected: 10_000,
    heading: 700,
    previous: 500,
    next: 480,
    section: 350,
    document: 100
};

function tokenize(value: string): Set<string> {
    const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
    const segments = normalized.match(/[\p{Script=Han}]+|[\p{Letter}\p{Number}]+/gu) ?? [];
    const tokens = new Set<string>();
    for (const segment of segments) {
        if (!/^\p{Script=Han}+$/u.test(segment) || segment.length === 1) {
            tokens.add(segment);
            continue;
        }
        for (let index = 0; index < segment.length - 1; index += 1) {
            tokens.add(segment.slice(index, index + 2));
        }
    }
    return tokens;
}
function overlapScore(left: Set<string>, right: Set<string>): number {
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) {
        if (right.has(token)) overlap += 1;
    }
    return overlap / Math.sqrt(left.size * right.size);
}

export function normalizeReadWeaveTitle(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").trim();
}

function ngrams(value: string): Set<string> {
    const normalized = normalizeReadWeaveTitle(value);
    if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
    const result = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) {
        result.add(normalized.slice(index, index + 2));
    }
    return result;
}

export function titleSimilarity(left: string, right: string): number {
    const normalizedLeft = normalizeReadWeaveTitle(left);
    const normalizedRight = normalizeReadWeaveTitle(right);
    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft === normalizedRight) return 1;

    const leftNgrams = ngrams(normalizedLeft);
    const rightNgrams = ngrams(normalizedRight);
    let intersection = 0;
    for (const gram of leftNgrams) {
        if (rightNgrams.has(gram)) intersection += 1;
    }
    return (2 * intersection) / (leftNgrams.size + rightNgrams.size);
}

type ReadWeaveQuestionIntent =
    | "definition"
    | "why"
    | "mechanism"
    | "prerequisite"
    | "example"
    | "comparison"
    | "tradeoff"
    | "condition"
    | "failure"
    | "evidence"
    | "verification"
    | "implication"
    | "fact"
    | "other";

function questionIntent(value: string): ReadWeaveQuestionIntent {
    if (/(?:比较|对比|区别|差异|相比|混淆)/u.test(value)) return "comparison";
    if (/(?:为什么|为何|原因|因果)/u.test(value)) return "why";
    if (/(?:如何工作|怎样工作|怎么工作|底层构成|整体机制|工作原理|运行机制)/u.test(value)) return "mechanism";
    if (/(?:前置知识|需要掌握|依赖顺序)/u.test(value)) return "prerequisite";
    if (/(?:举例|例子|示例)/u.test(value)) return "example";
    if (/(?:权衡|收益|代价|利弊)/u.test(value)) return "tradeoff";
    if (/(?:什么条件|哪些条件|成立条件|适用条件|何时成立|何时适用)/u.test(value)) return "condition";
    if (/(?:失败|失效|报错|异常|根因)/u.test(value)) return "failure";
    if (/(?:证据|来源|已证实|事实|推断|未知项)/u.test(value)) return "evidence";
    if (/(?:验证|判据|测试|通过条件)/u.test(value)) return "verification";
    if (/(?:意味着什么|影响|后续步骤)/u.test(value)) return "implication";
    if (/(?:是什么|是什么意思|指什么|什么是|请解释|解释一下)/u.test(value)) return "definition";
    if (/(?:谁|何时|什么时候|哪里|何处|多少|哪一个|哪一项|哪个|哪年)/u.test(value)) return "fact";
    return "other";
}

/**
 * Extracts the semantic object of a question while deliberately dropping
 * reusable prompt boilerplate. Candidate matching must never treat phrases
 * such as “请给出通用、详细说明” as evidence that two topics are related.
 */
export function extractReadWeaveQuestionSubject(value: string): string {
    const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const quoted = normalized.match(/[“"'‘]([^”"'’]{1,200})[”"'’]/u)?.[1]?.trim();
    if (quoted) return quoted;

    const core = normalized.split(/[？?]/u, 1)[0]?.trim() ?? "";
    const direct = [
        core.match(/^(?:什么是|请解释|解释一下)\s*(.+)$/u)?.[1],
        core.match(/^为什么(?:会)?出现\s*(.+)$/u)?.[1],
        core.match(/^理解\s*(.+?)\s*之前需要/u)?.[1],
        core.match(/^请用.+?解释\s*(.+)$/u)?.[1],
        core.match(/^怎样验证关于\s*(.+?)\s*的结论/u)?.[1],
        core.match(/^关于\s*(.+?)\s*有哪些可靠证据/u)?.[1],
        core.match(/^(.+?)\s*(?:是什么意思|是什么|指什么|是谁|是何人|是如何工作的|如何工作|意味着什么)$/u)?.[1],
        core.match(/^(.+?)\s*(?:为什么|为何|涉及哪些|在什么条件下|可能怎样|容易和哪些)/u)?.[1]
    ].find(candidate => candidate?.trim());

    return (direct ?? core)
        .replace(/^(?:请问|请说明|请分析|在当前(?:上下文|语境|文档|段落)中)[，,:：\s]*/u, "")
        .replace(/^[“"'‘]+|[”"'’]+$/gu, "")
        .trim();
}

export function questionTitleSimilarity(left: string, right: string): number {
    return analyzeQuestionTitleMatch(left, right).confidence;
}

function analyzeQuestionTitleMatch(left: string, right: string): {
    confidence: number;
    topicConfidence: number;
    sameTopic: boolean;
    intentMatch: boolean;
} {
    const normalizedLeft = normalizeReadWeaveTitle(left);
    const normalizedRight = normalizeReadWeaveTitle(right);
    if (!normalizedLeft || !normalizedRight) {
        return { confidence: 0, topicConfidence: 0, sameTopic: false, intentMatch: false };
    }

    const leftSubject = extractReadWeaveQuestionSubject(left);
    const rightSubject = extractReadWeaveQuestionSubject(right);
    const subjectSimilarity = titleSimilarity(leftSubject, rightSubject);
    const sameSubject = normalizeReadWeaveTitle(leftSubject) === normalizeReadWeaveTitle(rightSubject);
    const sameIntent = questionIntent(left) === questionIntent(right);
    if (normalizedLeft === normalizedRight || (sameSubject && sameIntent)) {
        return { confidence: 1, topicConfidence: 1, sameTopic: true, intentMatch: true };
    }

    // A shared generic template is not a semantic match. Requiring meaningful
    // subject overlap prevents unrelated “X 是什么” questions from surfacing.
    if (subjectSimilarity < 0.45) {
        return {
            confidence: 0,
            topicConfidence: Math.round(subjectSimilarity * 1_000) / 1_000,
            sameTopic: false,
            intentMatch: sameIntent
        };
    }

    const intentFactor = sameIntent ? 0.95 : 0.7;
    return {
        confidence: Math.round(subjectSimilarity * intentFactor * 1_000) / 1_000,
        topicConfidence: Math.round(subjectSimilarity * 1_000) / 1_000,
        sameTopic: sameSubject,
        intentMatch: sameIntent
    };
}

export function findReadWeaveCandidates(
    title: string,
    kind: ReadWeaveObjectKind,
    objects: ReadWeaveObject[],
    limit = 3,
    termIdentity?: Partial<ReadWeaveTermIdentity>
): ReadWeaveCandidate[] {
    return objects
        .filter(object => object.kind === kind)
        .map(object => {
            const questionMatch = kind === "question" ? analyzeQuestionTitleMatch(title, object.title) : undefined;
            const confidence = Math.max(
                questionMatch?.confidence ?? titleSimilarity(title, object.title),
                kind === "term" ? termIdentitySimilarity(title, termIdentity, object.termIdentity) : 0
            );
            return {
                objectId: object.objectId,
                kind: object.kind,
                title: object.title,
                confidence: Math.round(confidence * 1_000) / 1_000,
                reuseRecommended: confidence >= (kind === "question" ? 0.9 : 0.82),
                ...(questionMatch ? {
                    topicConfidence: questionMatch.topicConfidence,
                    sameTopic: questionMatch.sameTopic,
                    intentMatch: questionMatch.intentMatch
                } : {})
            } satisfies ReadWeaveCandidate;
        })
        .filter(candidate => candidate.confidence >= (kind === "question" ? 0.55 : 0.45))
        .toSorted((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title))
        .slice(0, Math.min(Math.max(limit, 1), 3));
}

function termIdentitySimilarity(
    title: string,
    query: Partial<ReadWeaveTermIdentity> | undefined,
    candidate: ReadWeaveTermIdentity | undefined
): number {
    if (!candidate) return 0;
    const fields: Array<keyof ReadWeaveTermIdentity> = [ "abbreviation", "chineseName", "englishName" ];
    const queryValues = [
        title,
        ...fields.map(field => query?.[field])
    ].map(value => value?.trim()).filter((value): value is string => Boolean(value));
    let best = 0;
    for (const left of queryValues) {
        for (const field of fields) {
            const right = candidate[field]?.trim();
            if (!right) continue;
            const similarity = titleSimilarity(left, right);
            if (similarity === 1) return 1;
            best = Math.max(best, similarity);
        }
    }
    return best;
}

export function selectReadWeaveContext(
    title: string,
    fragments: ReadWeaveContextFragment[],
    characterBudget = 6_000,
    includeDocument = false
): { fragments: ReadWeaveContextFragment[]; decision: ReadWeaveContextDecision } {
    const budget = Math.min(Math.max(characterBudget, 800), 80_000);
    const promptTokens = tokenize(title);
    const unique = new Map<string, ReadWeaveContextFragment>();
    for (const fragment of fragments) {
        const text = fragment.text.replace(/\s+/g, " ").trim();
        if (!text || unique.has(fragment.id)) continue;
        unique.set(fragment.id, { ...fragment, text: text.slice(0, 80_000) });
    }

    const ranked = Array.from(unique.values()).map((fragment, originalIndex) => {
        const relevance = overlapScore(promptTokens, tokenize(fragment.text));
        return {
            fragment,
            originalIndex,
            relevance,
            score: ROLE_WEIGHT[fragment.role]
                + relevance * 1_000
                - Math.max(fragment.distance ?? 0, 0) * 15
        };
    }).filter(item => item.fragment.role !== "document" || includeDocument || item.relevance > 0)
        .toSorted((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);

    const selected: typeof ranked = [];
    let characterCount = 0;
    for (const item of ranked) {
        const remaining = budget - characterCount;
        if (remaining <= 0) break;
        if (item.fragment.text.length > remaining && item.fragment.role !== "selected") continue;
        const fragment = item.fragment.text.length > remaining
            ? { ...item.fragment, text: item.fragment.text.slice(0, remaining) }
            : item.fragment;
        selected.push({ ...item, fragment });
        characterCount += fragment.text.length;
    }

    selected.sort((left, right) => left.originalIndex - right.originalIndex);
    return {
        fragments: selected.map(item => item.fragment),
        decision: {
            fragmentIds: selected.map(item => item.fragment.id),
            characterCount,
            characterBudget: budget,
            expansionLevel: 0,
            attemptedBudgets: [ budget ]
        }
    };
}
