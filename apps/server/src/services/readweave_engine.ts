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

export function findReadWeaveCandidates(
    title: string,
    kind: ReadWeaveObjectKind,
    objects: ReadWeaveObject[],
    limit = 8,
    termIdentity?: Partial<ReadWeaveTermIdentity>
): ReadWeaveCandidate[] {
    return objects
        .filter(object => object.kind === kind)
        .map(object => {
            const confidence = Math.max(
                titleSimilarity(title, object.title),
                kind === "term" ? termIdentitySimilarity(title, termIdentity, object.termIdentity) : 0
            );
            return {
                objectId: object.objectId,
                kind: object.kind,
                title: object.title,
                confidence: Math.round(confidence * 1_000) / 1_000,
                reuseRecommended: confidence >= 0.82
            } satisfies ReadWeaveCandidate;
        })
        .filter(candidate => candidate.confidence >= 0.2)
        .toSorted((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title))
        .slice(0, limit);
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
