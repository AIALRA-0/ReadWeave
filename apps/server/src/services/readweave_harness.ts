import type {
    ReadWeaveHarnessCase,
    ReadWeaveHarnessModules,
    ReadWeaveHarnessProfile,
    ReadWeaveHarnessTrialResult
} from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import { randomUUID } from "crypto";

import sql from "./sql.js";
import { generateUnifiedReadWeaveAnswer } from "./readweave_unified_ai.js";
import {
    READWEAVE_HOLDOUT_QUALITY_CASES,
    READWEAVE_VISIBLE_QUALITY_CASES
} from "./readweave_quality_cases.js";

interface HarnessRow {
    versionId: string;
    name: string;
    status: ReadWeaveHarnessProfile["status"];
    parentVersionId: string | null;
    modulesJson: string;
    casesJson: string;
    lastTrialJson: string | null;
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
}

const DEFAULT_VERSION = "quality-closure-v2.2.0";
const MAX_MODULE_LENGTH = 20_000;
const MAX_CASES = 500;
let storageReady = false;

export const DEFAULT_READWEAVE_HARNESS_MODULES: ReadWeaveHarnessModules = {
    questionNormalization: [
        "只修正乱码、引号、冒号、空格、大小写、错别字和明显病句",
        "保留用户原始问题的对象、范围和提问维度",
        "识别身份、定义、形态、机制、原因、比较、步骤或评价，不追加模板说明"
    ].join("\n"),
    evidencePolicy: [
        "文章选区只用于消歧，不自动视为通用事实",
        "人物现任信息、时效事实、数学结论和技术定义需要独立证据或可复算推导",
        "证据冲突时保留未解决状态，不用来源数量替代来源质量"
    ].join("\n"),
    answerWriting: [
        "第一句直接回答用户所问的维度",
        "面向没有先验知识的读者解释必要概念",
        "删除文章复述、无关论文、同义重复、空泛总结和未解释术语",
        "解释增益、差值、变化量或百分比时先写清计算方向，后续公式、正负号和文字结论必须使用同一方向",
        "长段落按身份、机制、边界或例子自然分段"
    ].join("\n"),
    semanticRubric: [
        "逐项检查问题命中、内部一致、证据支持、时效性和完整性",
        "问形态时必须说明载体或结构，问机制时必须说明输入、过程和结果",
        "复算增益、差值、变化量、百分比和边界条件，检查定义方向、公式符号和文字解释是否一致",
        "任何无法独立核验的核心事实都不能标记为绿色"
    ].join("\n"),
    formatRules: [
        "确定性修复乱码、标点、中英文空格、括号和大小写",
        "中文正文不使用中文句号，句内优先使用分号或换行",
        "缩写首次出现使用缩写 中文全称（English Full Name），禁止嵌套括号"
    ].join("\n")
};

const DEFAULT_CASES: ReadWeaveHarnessCase[] = READWEAVE_VISIBLE_QUALITY_CASES;

function ensureStorage() {
    if (storageReady) return;
    sql.executeScript(/* sql */`
        CREATE TABLE IF NOT EXISTS readweave_harness_profiles (
            versionId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            parentVersionId TEXT,
            modulesJson TEXT NOT NULL,
            casesJson TEXT NOT NULL,
            lastTrialJson TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            publishedAt TEXT
        );
        CREATE INDEX IF NOT EXISTS readweave_harness_profiles_status
            ON readweave_harness_profiles(status, updatedAt DESC);
    `);
    const count = sql.getValue<number>("SELECT COUNT(*) FROM readweave_harness_profiles") ?? 0;
    if (count === 0) {
        const timestamp = new Date().toISOString();
        sql.execute(/* sql */`
            INSERT INTO readweave_harness_profiles (
                versionId, name, status, parentVersionId, modulesJson, casesJson,
                lastTrialJson, createdAt, updatedAt, publishedAt
            ) VALUES (?, ?, 'published', NULL, ?, ?, NULL, ?, ?, ?)
        `, [
            DEFAULT_VERSION,
            "ReadWeave 质量闭环 v2",
            JSON.stringify(DEFAULT_READWEAVE_HARNESS_MODULES),
            JSON.stringify(DEFAULT_CASES),
            timestamp,
            timestamp,
            timestamp
        ]);
    } else {
        const defaultRow = sql.getRowOrNull<HarnessRow>("SELECT * FROM readweave_harness_profiles WHERE versionId = ?", [ DEFAULT_VERSION ]);
        if (!defaultRow) {
            const published = sql.getRowOrNull<HarnessRow>(
                "SELECT * FROM readweave_harness_profiles WHERE status = 'published' ORDER BY publishedAt DESC LIMIT 1"
            );
            const timestamp = new Date().toISOString();
            sql.execute(/* sql */`
                INSERT INTO readweave_harness_profiles (
                    versionId, name, status, parentVersionId, modulesJson, casesJson,
                    lastTrialJson, createdAt, updatedAt, publishedAt
                ) VALUES (?, ?, 'draft', ?, ?, ?, NULL, ?, ?, NULL)
            `, [
                DEFAULT_VERSION,
                "ReadWeave 质量闭环 v2.2",
                published?.versionId ?? null,
                JSON.stringify(DEFAULT_READWEAVE_HARNESS_MODULES),
                JSON.stringify(DEFAULT_CASES),
                timestamp,
                timestamp
            ]);
        }
    }
    storageReady = true;
}

function parseJson<T>(value: string): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        throw new ValidationError("ReadWeave Harness 数据损坏");
    }
}

function parseTrial(value: string): ReadWeaveHarnessTrialResult {
    const raw = parseJson<Partial<ReadWeaveHarnessTrialResult>>(value);
    const totalCases = typeof raw.totalCases === "number" ? raw.totalCases : 0;
    const passedCases = typeof raw.passedCases === "number" ? raw.passedCases : 0;
    return {
        versionId: typeof raw.versionId === "string" ? raw.versionId : "unknown",
        passed: raw.passed === true,
        totalCases,
        passedCases,
        visibleCases: typeof raw.visibleCases === "number" ? raw.visibleCases : Math.max(0, totalCases - READWEAVE_HOLDOUT_QUALITY_CASES.length),
        hiddenCases: typeof raw.hiddenCases === "number" ? raw.hiddenCases : READWEAVE_HOLDOUT_QUALITY_CASES.length,
        hiddenFailedCases: typeof raw.hiddenFailedCases === "number" ? raw.hiddenFailedCases : 0,
        failedCases: Array.isArray(raw.failedCases) ? raw.failedCases : []
    };
}

function profileFor(row: HarnessRow): ReadWeaveHarnessProfile {
    return {
        versionId: row.versionId,
        name: row.name,
        status: row.status,
        parentVersionId: row.parentVersionId || undefined,
        modules: parseJson<ReadWeaveHarnessModules>(row.modulesJson),
        cases: parseJson<ReadWeaveHarnessCase[]>(row.casesJson),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        publishedAt: row.publishedAt || undefined,
        lastTrial: row.lastTrialJson ? parseTrial(row.lastTrialJson) : undefined
    };
}

function rowFor(versionId: string): HarnessRow {
    ensureStorage();
    const row = sql.getRowOrNull<HarnessRow>("SELECT * FROM readweave_harness_profiles WHERE versionId = ?", [ versionId ]);
    if (!row) throw new ValidationError("ReadWeave Harness 版本不存在");
    return row;
}

function requireText(value: unknown, field: string, maximum: number): string {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw new ValidationError(`${field} 无效`);
    }
    return value.trim();
}

function normalizeModules(value: unknown): ReadWeaveHarnessModules {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Harness 模块无效");
    const raw = value as Partial<ReadWeaveHarnessModules>;
    return {
        questionNormalization: requireText(raw.questionNormalization, "问题归一化模块", MAX_MODULE_LENGTH),
        evidencePolicy: requireText(raw.evidencePolicy, "证据规则模块", MAX_MODULE_LENGTH),
        answerWriting: requireText(raw.answerWriting, "回答提示词模块", MAX_MODULE_LENGTH),
        semanticRubric: requireText(raw.semanticRubric, "语义评分模块", MAX_MODULE_LENGTH),
        formatRules: requireText(raw.formatRules, "格式规则模块", MAX_MODULE_LENGTH)
    };
}

function normalizeCases(value: unknown): ReadWeaveHarnessCase[] {
    if (!Array.isArray(value) || value.length > MAX_CASES) throw new ValidationError("Harness 测试案例无效");
    const ids = new Set<string>();
    return value.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ValidationError(`Harness 案例 ${index + 1} 无效`);
        const raw = candidate as Partial<ReadWeaveHarnessCase>;
        const caseId = requireText(raw.caseId, "caseId", 128);
        if (!/^[A-Za-z0-9_-]+$/u.test(caseId) || ids.has(caseId)) throw new ValidationError(`Harness 案例 ${caseId} 重复或无效`);
        ids.add(caseId);
        return {
            caseId,
            category: requireText(raw.category, "案例分类", 100),
            question: requireText(raw.question, "案例问题", 1_000),
            context: typeof raw.context === "string" && raw.context.trim() ? raw.context.trim().slice(0, 20_000) : undefined,
            expectedFacts: Array.isArray(raw.expectedFacts)
                ? raw.expectedFacts.map(item => requireText(item, "预期事实", 500)).slice(0, 20)
                : [],
            forbiddenClaims: Array.isArray(raw.forbiddenClaims)
                ? raw.forbiddenClaims.map(item => requireText(item, "禁用断言", 500)).slice(0, 20)
                : [],
            critical: raw.critical === true,
            expectedIntent: raw.expectedIntent === "identity" || raw.expectedIntent === "definition"
                || raw.expectedIntent === "form" || raw.expectedIntent === "mechanism"
                || raw.expectedIntent === "reason" || raw.expectedIntent === "comparison"
                || raw.expectedIntent === "calculation" || raw.expectedIntent === "boundary"
                ? raw.expectedIntent
                : undefined,
            badAnswer: typeof raw.badAnswer === "string" && raw.badAnswer.trim()
                ? raw.badAnswer.trim().slice(0, 20_000)
                : undefined,
            referenceAnswer: typeof raw.referenceAnswer === "string" && raw.referenceAnswer.trim()
                ? raw.referenceAnswer.trim().slice(0, 20_000)
                : undefined
        };
    });
}

export function listReadWeaveHarnessProfiles(): ReadWeaveHarnessProfile[] {
    ensureStorage();
    return sql.getRows<HarnessRow>("SELECT * FROM readweave_harness_profiles ORDER BY updatedAt DESC").map(profileFor);
}

export function getReadWeaveHarnessProfile(versionId: string): ReadWeaveHarnessProfile {
    return profileFor(rowFor(versionId));
}

export function getPublishedReadWeaveHarnessProfile(): ReadWeaveHarnessProfile {
    ensureStorage();
    const row = sql.getRowOrNull<HarnessRow>("SELECT * FROM readweave_harness_profiles WHERE status = 'published' ORDER BY publishedAt DESC LIMIT 1");
    return row ? profileFor(row) : getReadWeaveHarnessProfile(DEFAULT_VERSION);
}

export function createReadWeaveHarnessDraft(input: { sourceVersionId?: unknown; name?: unknown }): ReadWeaveHarnessProfile {
    ensureStorage();
    const source = typeof input.sourceVersionId === "string" && input.sourceVersionId.trim()
        ? getReadWeaveHarnessProfile(input.sourceVersionId)
        : getPublishedReadWeaveHarnessProfile();
    const versionId = `harness-${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 200) : `${source.name} 副本`;
    sql.execute(/* sql */`
        INSERT INTO readweave_harness_profiles (
            versionId, name, status, parentVersionId, modulesJson, casesJson,
            lastTrialJson, createdAt, updatedAt, publishedAt
        ) VALUES (?, ?, 'draft', ?, ?, ?, NULL, ?, ?, NULL)
    `, [ versionId, name, source.versionId, JSON.stringify(source.modules), JSON.stringify(source.cases), timestamp, timestamp ]);
    return getReadWeaveHarnessProfile(versionId);
}

export function updateReadWeaveHarnessDraft(versionId: string, input: { name?: unknown; modules?: unknown; cases?: unknown }): ReadWeaveHarnessProfile {
    const existing = getReadWeaveHarnessProfile(versionId);
    if (existing.status !== "draft" && existing.status !== "trial") throw new ValidationError("只有 Harness 草稿或已试跑版本可以修改");
    const name = input.name === undefined ? existing.name : requireText(input.name, "Harness 名称", 200);
    const modules = input.modules === undefined ? existing.modules : normalizeModules(input.modules);
    const cases = input.cases === undefined ? existing.cases : normalizeCases(input.cases);
    sql.execute(/* sql */`
        UPDATE readweave_harness_profiles
        SET name = ?, status = 'draft', modulesJson = ?, casesJson = ?, lastTrialJson = NULL, updatedAt = ?
        WHERE versionId = ?
    `, [ name, JSON.stringify(modules), JSON.stringify(cases), new Date().toISOString(), versionId ]);
    return getReadWeaveHarnessProfile(versionId);
}

export function addReadWeaveHarnessCase(versionId: string, input: unknown): ReadWeaveHarnessProfile {
    const existing = getReadWeaveHarnessProfile(versionId);
    if (existing.status !== "draft" && existing.status !== "trial") throw new ValidationError("只有 Harness 草稿或已试跑版本可以加入案例");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Harness 案例无效");
    const raw = input as Partial<ReadWeaveHarnessCase>;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const candidate = {
        ...raw,
        caseId: typeof raw.caseId === "string" && raw.caseId.trim() ? raw.caseId.trim() : `user-${suffix}`,
        category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "用户反馈",
        expectedFacts: Array.isArray(raw.expectedFacts) ? raw.expectedFacts : [],
        forbiddenClaims: Array.isArray(raw.forbiddenClaims) ? raw.forbiddenClaims : [],
        critical: raw.critical !== false
    };
    return updateReadWeaveHarnessDraft(versionId, { cases: [ ...existing.cases, candidate ] });
}

function compactForEvaluation(value: string): string {
    return value.normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/\\(?:text|mathrm|operatorname|frac)/gu, "")
        .replace(/[^\p{L}\p{N}+.%/-]+/gu, "");
}

function expectedFactPresent(answer: string, expectation: string): boolean {
    const normalizedAnswer = compactForEvaluation(answer);
    return expectation.split(/\s*\|\|\s*/u).some(alternative => {
        const normalized = compactForEvaluation(alternative);
        return normalized.length > 0 && normalizedAnswer.includes(normalized);
    });
}

function inferExpectedIntent(testCase: ReadWeaveHarnessCase): NonNullable<ReadWeaveHarnessCase["expectedIntent"]> {
    if (testCase.expectedIntent) return testCase.expectedIntent;
    const question = testCase.question;
    if (/(?:是谁|是何人|人物|个人简介)/u.test(question)) return "identity";
    if (/(?:具体.*(?:形态|形式)|以什么.*存在)/u.test(question)) return "form";
    if (/(?:如何工作|怎么工作|工作原理|如何实现|怎么实现|如何形成|如何更新|怎样形成)/u.test(question)) return "mechanism";
    if (/(?:为什么|为何|原因)/u.test(question)) return "reason";
    if (/(?:区别|比较|差异|有什么不同|分别)/u.test(question)) return "comparison";
    if (/(?:计算|多少|相差|增幅|降幅)/u.test(question)) return "calculation";
    if (/(?:能否|是否一定|是否只要|能不能保证|限制了什么)/u.test(question)) return "boundary";
    return "definition";
}

function deterministicHarnessIssues(testCase: ReadWeaveHarnessCase, answer: string): string[] {
    const issues: string[] = [];
    const normalized = answer.normalize("NFKC").trim();
    if (!normalized) return [ "缺少试跑答案" ];
    if (normalized.includes("。")) issues.push("仍包含中文句号");
    if (/&#(?:x[0-9a-f]+|\d+);?/iu.test(normalized)) issues.push("包含未解码字符实体");
    if (/[（(][^（）()\n]{0,180}[（(]/u.test(normalized)) issues.push("包含嵌套括号");
    if (normalized.split(/\n{2,}/u).some(paragraph => paragraph.length > 320)) issues.push("包含过长段落");
    const paragraphs = normalized.split(/\n{2,}/u)
        .map(paragraph => compactForEvaluation(paragraph))
        .filter(paragraph => paragraph.length >= 20);
    if (new Set(paragraphs).size !== paragraphs.length) issues.push("包含重复段落");

    const intent = inferExpectedIntent(testCase);
    const opening = normalized.split(/\n{2,}/u)[0] ?? normalized;
    if (intent === "identity" && !/(?:是|曾是|担任|任职|从事|学者|工程师|作家|科学家|研究者|教授|创始人)/u.test(opening)) {
        issues.push("没有先直接说明人物身份");
    } else if (intent === "form" && !/(?:物理|逻辑|硬件|软件|协议|报文|事务|接口|文件|服务|组织|结构|载体)/u.test(opening)) {
        issues.push("没有直接说明对象形态或载体");
    } else if (intent === "mechanism" && !/(?:输入|接收|先|随后|然后|通过|利用|转换|传递|输出|结果|反馈|循环)/u.test(normalized)) {
        issues.push("没有说明输入、关键过程和结果");
    } else if (intent === "reason" && !/(?:因为|原因|导致|使得|取决于|源于|因此|所以|由于)/u.test(normalized)) {
        issues.push("没有说明因果关系");
    } else if (intent === "comparison" && !/(?:不同|区别|相比|而|前者|后者|共同|分别|取舍)/u.test(normalized)) {
        issues.push("没有明确比较维度和差异");
    } else if (intent === "calculation" && !/\d/u.test(normalized)) {
        issues.push("计算回答没有给出数值结果");
    } else if (intent === "boundary" && !/(?:不能|不一定|取决于|仅|条件|边界|不足以|需要)/u.test(normalized)) {
        issues.push("边界问题被写成无条件结论");
    }
    if (testCase.badAnswer && compactForEvaluation(testCase.badAnswer) === compactForEvaluation(normalized)) {
        issues.push("答案与已标注错误答案相同");
    }
    return issues;
}

export async function trialReadWeaveHarnessProfile(
    versionId: string,
    input: { answers?: Array<{ caseId?: unknown; answer?: unknown }> }
): Promise<ReadWeaveHarnessTrialResult> {
    const profile = getReadWeaveHarnessProfile(versionId);
    const cases = [ ...profile.cases, ...READWEAVE_HOLDOUT_QUALITY_CASES ];
    const suppliedAnswers = new Map<string, string>();
    if (Array.isArray(input.answers)) {
        for (const item of input.answers) {
            if (typeof item?.caseId !== "string" || typeof item.answer !== "string") continue;
            suppliedAnswers.set(item.caseId, item.answer.slice(0, 40_000));
        }
    }
    const outcomes = await mapWithConcurrency(cases, 2, async testCase => {
        const supplied = suppliedAnswers.get(testCase.caseId);
        if (supplied !== undefined) {
            return { testCase, answer: supplied, generatedVerified: true, generationIssues: [] as string[] };
        }
        try {
            const result = await generateUnifiedReadWeaveAnswer({
                articleId: `harness:${versionId}`,
                anchorId: testCase.caseId,
                anchorType: "range",
                kind: /(?:是什么|谁|全称|缩写)/u.test(testCase.question) ? "term" : "question",
                title: testCase.question,
                fragments: [ {
                    id: "selected",
                    role: "selected",
                    text: testCase.context?.trim() || `独立质量回归案例：${testCase.question}`
                } ]
            }, undefined, undefined, profile);
            return {
                testCase,
                answer: result.body,
                generatedVerified: result.qualityState === "verified",
                generationIssues: result.unresolvedIssues ?? result.reviewIssues ?? []
            };
        } catch (error) {
            return {
                testCase,
                answer: "",
                generatedVerified: false,
                generationIssues: [ error instanceof Error ? error.message : "试跑生成失败" ]
            };
        }
    });
    const allFailedCases = outcomes.flatMap(({ testCase, answer: rawAnswer, generatedVerified, generationIssues }) => {
        const answer = rawAnswer.normalize("NFKC").trim();
        const issues = [
            ...deterministicHarnessIssues(testCase, answer),
            ...(!generatedVerified ? [ "答案未通过独立核验", ...generationIssues ] : []),
            ...testCase.expectedFacts.filter(fact => !expectedFactPresent(answer, fact)).map(fact => `缺少预期事实：${fact}`),
            ...testCase.forbiddenClaims.filter(claim => expectedFactPresent(answer, claim)).map(claim => `包含禁用断言：${claim}`)
        ];
        return issues.length > 0 ? [ { caseId: testCase.caseId, issues } ] : [];
    });
    const failedCases = allFailedCases.filter(item => !item.caseId.startsWith("holdout-"));
    const hiddenFailedCases = allFailedCases.length - failedCases.length;
    const result: ReadWeaveHarnessTrialResult = {
        versionId,
        passed: allFailedCases.length === 0,
        totalCases: cases.length,
        passedCases: cases.length - allFailedCases.length,
        visibleCases: profile.cases.length,
        hiddenCases: READWEAVE_HOLDOUT_QUALITY_CASES.length,
        hiddenFailedCases,
        failedCases
    };
    sql.execute("UPDATE readweave_harness_profiles SET status = ?, lastTrialJson = ?, updatedAt = ? WHERE versionId = ?", [
        result.passed ? "trial" : "draft", JSON.stringify(result), new Date().toISOString(), versionId
    ]);
    return result;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(runners);
    return results;
}

export function publishReadWeaveHarnessProfile(versionId: string): ReadWeaveHarnessProfile {
    const row = rowFor(versionId);
    if (row.status !== "trial") throw new ValidationError("只有已经通过试跑的 Harness 版本可以发布");
    const trial = row.lastTrialJson ? parseJson<ReadWeaveHarnessTrialResult>(row.lastTrialJson) : undefined;
    if (!trial?.passed) throw new ValidationError("Harness 必须先通过全部试跑案例");
    const timestamp = new Date().toISOString();
    sql.transactional(() => {
        sql.execute("UPDATE readweave_harness_profiles SET status = 'archived', updatedAt = ? WHERE status = 'published'", [ timestamp ]);
        sql.execute("UPDATE readweave_harness_profiles SET status = 'published', publishedAt = ?, updatedAt = ? WHERE versionId = ?", [
            timestamp, timestamp, versionId
        ]);
    });
    return getReadWeaveHarnessProfile(versionId);
}

export function rollbackReadWeaveHarnessProfile(versionId: string): ReadWeaveHarnessProfile {
    const source = getReadWeaveHarnessProfile(versionId);
    if (source.status === "draft") throw new ValidationError("未发布草稿不能作为回滚目标");
    const timestamp = new Date().toISOString();
    sql.transactional(() => {
        sql.execute("UPDATE readweave_harness_profiles SET status = 'archived', updatedAt = ? WHERE status = 'published'", [ timestamp ]);
        sql.execute("UPDATE readweave_harness_profiles SET status = 'published', publishedAt = ?, updatedAt = ? WHERE versionId = ?", [
            timestamp, timestamp, versionId
        ]);
    });
    return getReadWeaveHarnessProfile(versionId);
}

export function archiveReadWeaveHarnessProfile(versionId: string): ReadWeaveHarnessProfile {
    const profile = getReadWeaveHarnessProfile(versionId);
    if (profile.status === "published") throw new ValidationError("当前发布版本不能直接归档，请先发布其他版本");
    sql.execute("UPDATE readweave_harness_profiles SET status = 'archived', updatedAt = ? WHERE versionId = ?", [
        new Date().toISOString(), versionId
    ]);
    return getReadWeaveHarnessProfile(versionId);
}
