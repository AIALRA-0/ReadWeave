import type {
    ReadWeaveClaim,
    ReadWeaveDomain,
    ReadWeaveDomainProfile,
    ReadWeaveEvidenceSource,
    ReadWeaveGenerateRequest
} from "@triliumnext/commons";

const PERSON_PATTERN = /(?:是谁|谁是|是何人|人物|个人简介|现任|任职|履历|背景|who\s+is|who\s+was|biograph)/iu;
const DEFINITION_PATTERN = /(?:是什么|什么是|是啥|啥是|含义|定义|指什么|什么意思|meaning|definition)/iu;
const CURRENT_PATTERN = /(?:现在|目前|现任|最新|当前|截至|today|current|latest|present|version)/iu;
const BIBLIOGRAPHIC_PATTERN = /(?:论文|文章|报告|规范|标准|出处|引用|期刊|会议|\b10\.\d{4,9}\/[\w.()/:;-]+\b)/iu;
const PROCEDURE_PATTERN = /(?:如何|怎么|怎样|步骤|流程|配置|安装|操作|使用|procedure|how\s+to)/iu;
const COMPARISON_PATTERN = /(?:区别|比较|差异|不同|优缺点|取舍|相比|compare|difference|tradeoff)/iu;
const CALCULATION_PATTERN = /(?:计算|多少|相差|增幅|降幅|百分比|算对|输入数据|求结果|公式|概率|calculate|formula)/iu;

function sourceAuthority(source: ReadWeaveEvidenceSource): NonNullable<ReadWeaveEvidenceSource["authority"]> {
    if (source.sourceType === "local") return "local";
    if (source.sourceCategory === "first-party-personal") return "first-party";
    if (source.sourceCategory === "official-profile" || source.sourceCategory === "institution") return "official";
    if (source.sourceCategory === "registry") return "index";
    const provider = `${source.provider} ${source.title}`.toLocaleLowerCase();
    if (/(?:official|官方|university|大学|kernel documentation|api docs|standard)/u.test(provider)) return "official";
    if (/(?:crossref|doi|publisher|dblp|semantic scholar|europe pmc|arxiv)/u.test(provider)) return "publisher";
    if (/(?:openalex|orcid)/u.test(provider)) return "index";
    return "secondary";
}

function sourceTimeScope(source: ReadWeaveEvidenceSource): NonNullable<ReadWeaveEvidenceSource["timeScope"]> {
    const text = `${source.title}\n${source.excerpt}`;
    if (/(?:current|present|现任|当前|至今|现为|目前)/iu.test(text)) return "current";
    if (/(?:ph\.d|博士|education|教育|毕业|论文|publication|发表|曾任|former|历史)/iu.test(text)) return "historical";
    return "undated";
}

function claimTypesForSource(source: ReadWeaveEvidenceSource): string[] {
    const text = `${source.title}\n${source.excerpt}`;
    const types = new Set<string>();
    if (/(?:current|present|现任|当前|至今|principal|professor|职位|机构|任职)/iu.test(text)) types.add("current-role");
    if (/(?:ph\.d|博士|education|教育|毕业|学位)/iu.test(text)) types.add("education");
    if (/(?:author|作者|论文|publication|发表|doi)/iu.test(text)) types.add("authorship");
    if (/(?:definition|定义|是什么|means|指的是)/iu.test(text)) types.add("definition");
    if (/(?:mechanism|机制|原理|通过|输入|输出)/iu.test(text)) types.add("mechanism");
    if (types.size === 0) types.add("general");
    return Array.from(types);
}

export function enrichReadWeaveEvidenceSource(source: ReadWeaveEvidenceSource): ReadWeaveEvidenceSource {
    return {
        ...source,
        authority: source.authority ?? sourceAuthority(source),
        claimTypes: source.claimTypes ?? claimTypesForSource(source),
        timeScope: source.timeScope ?? sourceTimeScope(source)
    };
}

export function buildReadWeaveDomainProfile(
    request: Pick<ReadWeaveGenerateRequest, "kind" | "title">,
    normalizedQuestion: string
): ReadWeaveDomainProfile {
    const text = `${normalizedQuestion}\n${request.title}`.normalize("NFKC").trim();
    const domains: ReadWeaveDomain[] = [];
    if (PERSON_PATTERN.test(text)) domains.push("identity");
    if (request.kind === "term" || DEFINITION_PATTERN.test(text)) domains.push("definition");
    if (BIBLIOGRAPHIC_PATTERN.test(text)) domains.push("bibliographic");
    if (CURRENT_PATTERN.test(text)) domains.push("current-status");
    if (PROCEDURE_PATTERN.test(text)) domains.push("procedure");
    if (COMPARISON_PATTERN.test(text)) domains.push("comparison");
    if (CALCULATION_PATTERN.test(text)) domains.push("calculation");
    if (domains.length === 0) domains.push("general");
    if (domains.includes("identity") && !domains.includes("current-status")) domains.push("current-status");
    // Explicit object identity and bibliographic requests outrank the generic
    // “是什么” wording. Otherwise “这篇论文的 DOI 是什么” is routed as a
    // definition merely because it contains the phrase “是什么”.
    const primaryDomain = ([ "identity", "bibliographic", "comparison", "calculation", "procedure", "definition", "current-status", "general" ] as ReadWeaveDomain[])
        .find(domain => domains.includes(domain)) ?? "general";
    const freshness = domains.includes("current-status")
        ? "current"
        : /(?:曾经|历史|当时|过去|historical|former)/iu.test(text) ? "historical" : "unknown";
    const risk: ReadWeaveDomainProfile["risk"] = domains.some(domain =>
        [ "identity", "current-status", "bibliographic", "calculation" ].includes(domain)
    ) ? "high" : domains.some(domain => [ "definition", "procedure", "comparison" ].includes(domain)) ? "medium" : "low";
    const requiredEvidenceTypes = Array.from(new Set([
        ...(domains.includes("identity") ? [ "current-role", "current-organization" ] : []),
        ...(domains.includes("current-status") ? [ "current-status", "date" ] : []),
        ...(domains.includes("bibliographic") ? [ "title", "authorship", "publisher", "doi" ] : []),
        ...(domains.includes("definition") ? [ "definition" ] : []),
        ...(domains.includes("procedure") ? [ "procedure-step", "precondition" ] : []),
        ...(domains.includes("calculation") ? [ "calculation-input", "formula", "result" ] : []),
        ...(domains.includes("comparison") ? [ "comparison-dimension", "tradeoff" ] : [])
    ]));
    const preferredSourceTypes = Array.from(new Set([
        ...(domains.includes("identity") || domains.includes("current-status") ? [ "official-profile", "institution", "ORCID" ] : []),
        ...(domains.includes("bibliographic") ? [ "publisher", "DOI", "standard-index" ] : []),
        ...(domains.includes("definition") ? [ "official-documentation", "standard", "publisher" ] : []),
        ...(domains.includes("calculation") ? [ "reproducible-input", "primary-data" ] : []),
        "local-context"
    ]));
    const answerChecks = Array.from(new Set([
        "answer-the-requested-dimension-first",
        "every-core-claim-has-a-source-or-is-marked-common-sense",
        "do-not-mix-current-and-historical-facts",
        ...(domains.includes("identity") ? [ "separate-role-education-and-authorship" ] : []),
        ...(domains.includes("calculation") ? [ "recalculate-formula-and-unit" ] : []),
        ...(domains.includes("bibliographic") ? [ "title-author-doi-must-refer-to-the-same-work" ] : [])
    ]));
    return {
        version: 1,
        primaryDomain,
        domains,
        risk,
        freshness,
        requiredEvidenceTypes,
        preferredSourceTypes,
        answerChecks
    };
}

export function buildReadWeaveEvidencePackSummary(
    sources: ReadWeaveEvidenceSource[],
    queryCount: number,
    warnings: string[] = []
) {
    const enriched = sources.map(enrichReadWeaveEvidenceSource);
    return {
        version: 1 as const,
        localSourceIds: enriched.filter(source => source.sourceType === "local").map(source => source.sourceId),
        externalSourceIds: enriched.filter(source => source.sourceType === "external").map(source => source.sourceId),
        sourceCount: enriched.length,
        queryCount,
        warnings: Array.from(new Set(warnings)).slice(0, 12)
    };
}

export function enrichReadWeaveClaim(
    claim: ReadWeaveClaim,
    sources: ReadWeaveEvidenceSource[],
    profile: ReadWeaveDomainProfile
): ReadWeaveClaim {
    const cited = claim.sourceIds
        .map(sourceId => sources.find(source => source.sourceId === sourceId))
        .filter((source): source is ReadWeaveEvidenceSource => Boolean(source));
    const claimType = claim.claimType
        ?? (profile.domains.includes("identity") && cited.some(source => source.claimTypes?.includes("current-role")) ? "current-role" : undefined)
        ?? (profile.domains.includes("bibliographic") && cited.some(source => source.claimTypes?.includes("authorship")) ? "authorship" : undefined)
        ?? (profile.domains.includes("definition") ? "definition" : "general");
    const timeScope = claim.timeScope
        ?? (cited.some(source => source.timeScope === "current") ? "current" : cited.some(source => source.timeScope === "historical") ? "historical" : "undated");
    return {
        ...claim,
        claimType,
        timeScope,
        status: claim.status ?? (claim.unresolved ? "unsupported" : "supported")
    };
}
