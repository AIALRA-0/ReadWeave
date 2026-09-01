import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const previousLegacyReplay = process.env.READWEAVE_ENABLE_LEGACY_REPLAY;
process.env.READWEAVE_ENABLE_LEGACY_REPLAY = "1";
afterAll(() => {
    if (previousLegacyReplay === undefined) delete process.env.READWEAVE_ENABLE_LEGACY_REPLAY;
    else process.env.READWEAVE_ENABLE_LEGACY_REPLAY = previousLegacyReplay;
});

vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "placeholder"
    })
}));

import { findReadWeaveQualityIssues, generateReadWeaveAnswer } from "./readweave_ai.js";

type JsonObject = Record<string, unknown>;

interface ScriptedRepairPipeline {
    evidencePlans: JsonObject[];
    generation: JsonObject;
    verifications: JsonObject[];
    repair: (prompt: string, callIndex: number) => JsonObject;
}

interface RecordedCompletion {
    kind: "evidence" | "generation" | "verification" | "repair";
    prompt: string;
}

function decodedPrompt(body: string): string {
    const payload = JSON.parse(body) as { messages?: Array<{ content?: unknown }> };
    return (payload.messages ?? [])
        .map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content))
        .join("\n\n");
}

function repairTargetSegment(prompt: string): string {
    const serialized = prompt.split("仅允许的修复：", 2)[1]?.split("\n\n", 1)[0];
    if (!serialized) throw new Error("The repair prompt has no allowed-repair block.");
    const repairs = JSON.parse(serialized) as Array<{ segmentId?: unknown }>;
    const segmentId = repairs[0]?.segmentId;
    if (typeof segmentId !== "string") throw new Error("The repair prompt has no target segment.");
    return segmentId;
}

function installRepairPipeline(script: ScriptedRepairPipeline): {
    records: RecordedCompletion[];
    remainingEvidencePlans: JsonObject[];
    remainingVerifications: JsonObject[];
} {
    const records: RecordedCompletion[] = [];
    const remainingEvidencePlans = [ ...script.evidencePlans ];
    const remainingVerifications = [ ...script.verifications ];
    let repairCalls = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/anthropic/v1/messages")) {
            return Response.json({
                model: "deepseek-v4-pro",
                stop_reason: "end_turn",
                content: [
                    {
                        type: "web_search_tool_result",
                        content: [ { type: "web_search_result", url: "https://www.ieee.org/readweave-test-evidence" } ]
                    },
                    { type: "text", text: "公开资料与测试上下文一致，未发现名称或事实冲突。" }
                ]
            });
        }
        if (!url.endsWith("/chat/completions")) throw new Error(`Unexpected endpoint: ${url}`);

        const body = typeof init?.body === "string" ? init.body : "";
        const prompt = decodedPrompt(body);
        let kind: RecordedCompletion["kind"];
        let content: JsonObject;
        if (prompt.includes("只建立完成任务所需的统一证据计划")) {
            kind = "evidence";
            const next = remainingEvidencePlans.shift();
            if (!next) throw new Error("The scripted evidence-plan queue is empty.");
            content = next;
        } else if (prompt.includes("只执行回答质量检查")) {
            kind = "verification";
            const next = remainingVerifications.shift();
            if (!next) throw new Error("The scripted verification queue is empty.");
            content = next;
        } else if (prompt.includes("只修复指定答案片段")) {
            kind = "repair";
            content = script.repair(prompt, repairCalls++);
        } else {
            kind = "generation";
            content = script.generation;
        }
        records.push({ kind, prompt });
        if (kind === "repair" && typeof content.__httpStatus === "number") {
            return Response.json({
                error: { message: typeof content.message === "string" ? content.message : "scripted repair failure" }
            }, { status: content.__httpStatus });
        }
        return Response.json({
            model: "deepseek-v4-pro",
            choices: [ { message: { content: JSON.stringify(content) } } ]
        });
    }));

    return { records, remainingEvidencePlans, remainingVerifications };
}

function termEvidencePlan(): JsonObject {
    return {
        requiredFacts: [ "该对象通过位置约束减少晶圆布局冲突" ],
        requiredClaims: [ "说明它是布局设计方法", "说明位置约束机制与适用边界" ],
        evidenceBoundaries: [ "不扩展到制造设备控制" ],
        ambiguities: [],
        canonicalEntityNeeds: [ "核验当前中文方法名" ],
        entityType: "method",
        resolvedSense: "利用位置约束降低冲突的晶圆布局设计方法"
    };
}

function termRequest(title: string): ReadWeaveGenerateRequest {
    return {
        articleId: "repair-resilience",
        anchorId: "repair-anchor",
        anchorType: "range",
        kind: "term",
        title,
        fragments: [ {
            id: "selected",
            role: "selected",
            text: "该晶圆布局优化方法通过约束元件位置减少冲突，适用范围不包含制造设备控制。"
        } ]
    };
}

function failedVerification(...repairs: Array<{ segmentId: string; issue: string }>): JsonObject {
    return {
        valid: false,
        needsMoreContext: false,
        issues: repairs.map(repair => repair.issue),
        repairs: repairs.map(repair => ({
            operation: "replace",
            segmentId: repair.segmentId,
            issue: repair.issue,
            instruction: `只修复${repair.issue}`
        }))
    };
}

function validVerification(): JsonObject {
    return { valid: true, needsMoreContext: false, issues: [], repairs: [] };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ReadWeave full-pipeline repair resilience", () => {
    it("removes an unsupported maturity appendix from a method definition while preserving its evidence-backed boundary", async () => {
        const body = "背面供电网络设计流程（BS-PDN-Last） 是论文提出的一种电源分配网络优化方法，属于背面供电网络设计流程，面向具有多功能背面金属层的设计空间搜索。该方法将电源与接地布线推迟至信号布线完成后进行，以此优化背面供电结构及信号资源分配，与传统的电源先行流程相对。背面供电网络设计流程（BS-PDN-Last） 并非行业标准术语，尚未经标准组织定义，其在工业界的实际采用情况与长期稳定性亦未得到公开确认。";
        const identity = {
            chineseName: "背面供电网络设计流程",
            englishName: "BS-PDN-Last"
        };
        const issue = "定义附加了与实体类型无关且未经证据支持的标准化、采用或成熟度负面说明";
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [
                    "该方法面向具有多功能背面金属层的设计空间搜索",
                    "该方法在信号布线后处理电源与接地布线",
                    "该方法与电源先行流程相对"
                ],
                requiredClaims: [ "说明它是背面供电网络设计方法及其流程边界" ],
                evidenceBoundaries: [ "定义限于论文描述的设计流程，不推断行业采用或长期稳定性" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "BS-PDN-Last 是方法原名，不是可展开缩写" ],
                entityType: "method",
                resolvedSense: "在信号布线后处理电源与接地布线的背面供电网络设计方法"
            } ],
            generation: {
                status: "sufficient",
                termIdentity: identity,
                body
            },
            verifications: [ validVerification() ],
            repair: prompt => ({
                status: "sufficient",
                patches: [ {
                    operation: "replace",
                    segmentId: repairTargetSegment(prompt),
                    text: ""
                } ]
            })
        });

        expect(findReadWeaveQualityIssues(body, "在当前语境中，BS-PDN-Last 是什么？", {
            kind: "term",
            subject: "BS-PDN-Last",
            termIdentity: identity,
            entityType: "method"
        })).toContain(issue);
        const reasonableBoundary = "背面供电网络设计流程（BS-PDN-Last）是论文提出的电源分配网络优化方法；它只适用于论文描述的背面金属层设计空间，尚未验证能否扩展到其他供电网络设计问题。";
        expect(findReadWeaveQualityIssues(reasonableBoundary, "在当前语境中，BS-PDN-Last 是什么？", {
            kind: "term",
            subject: "BS-PDN-Last",
            termIdentity: identity,
            entityType: "method"
        })).not.toContain(issue);
        const standardStatusBoundary = "候选接口标准（Draft Interface Standard）是一项尚未经标准组织正式发布的候选规范；其工业界采用情况与长期稳定性尚未得到公开确认。";
        expect(findReadWeaveQualityIssues(standardStatusBoundary, "在当前语境中，候选接口标准是什么？", {
            kind: "term",
            subject: "候选接口标准",
            termIdentity: { chineseName: "候选接口标准", englishName: "Draft Interface Standard" },
            entityType: "standard"
        })).not.toContain(issue);

        const result = await generateReadWeaveAnswer({
            articleId: "repair-method-negative-appendix",
            anchorId: "repair-method-negative-appendix-anchor",
            anchorType: "range",
            kind: "term",
            title: "BS-PDN-Last",
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "BS-PDN-Last 是论文提出的背面供电网络设计方法，在信号布线完成后处理电源与接地布线，面向多功能背面金属层的设计空间搜索。"
            } ]
        });

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toContain("与传统的电源先行流程相对");
        expect(result.body).not.toMatch(/行业标准术语|标准组织|工业界|长期稳定性/u);
        expect(result.workflow).toMatchObject({ repairRounds: 1, validationPasses: 1 });
        const repairs = pipeline.records.filter(record => record.kind === "repair");
        expect(repairs).toHaveLength(1);
        expect(repairs[0].prompt).toContain(issue);
        expect(repairs[0].prompt).toContain('"segmentId":"seg-3"');
        expect(pipeline.remainingEvidencePlans).toEqual([]);
        expect(pipeline.remainingVerifications).toEqual([]);
    });

    it("returns an unauthorized repair identity to the same model and keeps every parallel body patch", async () => {
        const segmentCalls = new Map<string, number>();
        const pipeline = installRepairPipeline({
            evidencePlans: [ termEvidencePlan() ],
            generation: {
                status: "sufficient",
                termIdentity: { chineseName: "晶圆布局优化方法" },
                body: "晶圆布局优化方法是一种通过位置约束减少元件冲突的设计方法；其作用范围限于资料所述的晶圆布局问题，不延伸到制造设备控制。"
            },
            verifications: [
                failedVerification(
                    { segmentId: "seg-1", issue: "对象类别需要更精确" },
                    { segmentId: "seg-2", issue: "适用边界需要更直接" }
                ),
                validVerification()
            ],
            repair: prompt => {
                const segmentId = repairTargetSegment(prompt);
                const call = (segmentCalls.get(segmentId) ?? 0) + 1;
                segmentCalls.set(segmentId, call);
                return segmentId === "seg-1" ? {
                    status: "sufficient",
                    ...(call === 1 ? { termIdentity: { chineseName: "Matrix" } } : {}),
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: "晶圆布局优化方法是一种利用位置约束降低元件冲突的布局设计方法。"
                    } ]
                } : {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: "它只处理资料中的晶圆布局优化边界，不涵盖制造设备控制。"
                    } ]
                };
            }
        });

        const result = await generateReadWeaveAnswer(termRequest("晶圆布局优化方法"));

        expect(result.body).toContain("利用位置约束降低元件冲突");
        expect(result.body).toContain("不涵盖制造设备控制");
        expect(result.termIdentity).toEqual({ chineseName: "晶圆布局优化方法" });
        expect(result.reviewIssues).toBeUndefined();
        expect(result.workflow).toMatchObject({ repairRounds: 1, unchangedSegmentsVerified: true });
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(3);
        expect(pipeline.records.some(record => record.kind === "repair"
            && record.prompt.includes("did not request an identity correction"))).toBe(true);
        expect(pipeline.remainingEvidencePlans).toEqual([]);
        expect(pipeline.remainingVerifications).toEqual([]);
    });

    it("rejects conflicting identity side effects inside parallel repairs before the unified recheck", async () => {
        const segmentCalls = new Map<string, number>();
        const pipeline = installRepairPipeline({
            evidencePlans: [ termEvidencePlan() ],
            generation: {
                status: "sufficient",
                termIdentity: { chineseName: "原始晶圆布局方法" },
                body: "原始晶圆布局方法是一种通过位置约束减少元件冲突的设计方法；其作用范围限于晶圆布局优化，不延伸到制造设备控制。"
            },
            verifications: [
                failedVerification(
                    { segmentId: "seg-1", issue: "首句机制需核准" },
                    { segmentId: "seg-2", issue: "边界需核准" }
                ),
                failedVerification({ segmentId: "seg-1", issue: "首句仍需补充最终约束" }),
                validVerification()
            ],
            repair: prompt => {
                const segmentId = repairTargetSegment(prompt);
                const call = (segmentCalls.get(segmentId) ?? 0) + 1;
                segmentCalls.set(segmentId, call);
                if (segmentId === "seg-1" && call === 1) {
                    return {
                        status: "sufficient",
                        termIdentity: { chineseName: "冲突身份甲" },
                        patches: [ {
                            operation: "replace",
                            segmentId,
                            text: "原始晶圆布局方法是一种以位置约束降低元件冲突的布局设计方法。"
                        } ]
                    };
                }
                if (segmentId === "seg-2" && call === 1) {
                    return {
                        status: "sufficient",
                        termIdentity: { chineseName: "冲突身份乙" },
                        patches: [ {
                            operation: "replace",
                            segmentId,
                            text: "它的边界是晶圆布局优化，不包含制造设备控制。"
                        } ]
                    };
                }
                return {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: "原始晶圆布局方法是一种通过约束元件位置减少冲突的晶圆布局优化方法。"
                    } ]
                };
            }
        });

        const result = await generateReadWeaveAnswer(termRequest("原始晶圆布局方法"));

        expect(result.termIdentity).toEqual({ chineseName: "原始晶圆布局方法" });
        expect(result.termIdentity?.chineseName).not.toMatch(/冲突身份|后续错误覆盖/u);
        expect(result.body).toContain("通过约束元件位置减少冲突");
        expect(result.reviewIssues).toBeUndefined();
        expect(result.workflow.repairRounds).toBe(2);
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(5);
        expect(pipeline.remainingVerifications).toEqual([]);
    });

    it("does not expand context when a format repair exhausts its budget without requesting evidence", async () => {
        const evidencePlan = {
            requiredFacts: [ "系统先校验输入，再依次处理并记录状态" ],
            requiredClaims: [ "说明处理顺序与可观察结果" ],
            evidenceBoundaries: [ "不推断资料未给出的工具和性能" ],
            ambiguities: [],
            canonicalEntityNeeds: []
        };
        const replacementTexts = [
            "系统先校验输入，再按顺序执行处理，并记录每一步的可观察状态。",
            "系统先校验输入，再按顺序执行处理，并记录开始、完成与失败状态。",
            "系统先校验输入，再按顺序执行处理，并依据扩展记录保存开始、完成与失败状态。"
        ];
        const pipeline = installRepairPipeline({
            evidencePlans: [ evidencePlan ],
            generation: {
                status: "sufficient",
                body: "系统在收到任务后先校验输入，再按顺序执行处理，并记录可观察结果；这一描述只覆盖资料明确给出的流程，不推断额外工具、协议、时间或性能表现。"
            },
            verifications: [
                failedVerification({ segmentId: "seg-1", issue: "窄上下文第一轮修复" }),
                failedVerification({ segmentId: "seg-1", issue: "窄上下文第二轮修复" }),
                failedVerification({ segmentId: "seg-1", issue: "窄上下文额度耗尽后仍有问题" }),
                failedVerification({ segmentId: "seg-1", issue: "非证据问题仍未修复" })
            ],
            repair: (_prompt, callIndex) => ({
                status: "sufficient",
                patches: [ {
                    operation: "replace",
                    segmentId: "seg-1",
                    text: replacementTexts[callIndex]
                } ]
            })
        });
        const longContext = "扩展记录补充了任务处理的开始、完成与失败状态。".repeat(70);
        const request: ReadWeaveGenerateRequest = {
            articleId: "repair-expansion",
            anchorId: "repair-expansion-anchor",
            anchorType: "range",
            kind: "question",
            title: "系统如何处理任务并记录结果？",
            characterBudget: 800,
            fragments: [
                {
                    id: "selected",
                    role: "selected",
                    text: "系统收到任务后先校验输入，再依次处理，并记录可观察结果。"
                },
                { id: "document", role: "document", text: longContext }
            ]
        };

        const result = await generateReadWeaveAnswer(request);

        expect(result.body).toContain("依据扩展记录保存开始、完成与失败状态");
        expect(result.reviewIssues).toContain("非证据问题仍未修复");
        expect(result.workflow).toMatchObject({ contextExpansions: 0, repairRounds: 3 });
        expect(result.context.attemptedBudgets).toHaveLength(1);
        expect(pipeline.records.filter(record => record.kind === "evidence")).toHaveLength(1);
        expect(pipeline.records.filter(record => record.kind === "verification")).toHaveLength(4);
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(3);
        expect(pipeline.remainingEvidencePlans).toEqual([]);
        expect(pipeline.remainingVerifications).toEqual([]);
    });

    it("normalizes the real Chinese-adjacent 3D/ML draft before it reaches targeted repair", async () => {
        const segmentCalls = new Map<string, number>();
        const badBody = "“3D堆叠ML 机器学习（Machine Learning）加速器”是一种利用三维垂直集成技术，通过TSV 硅通孔（Through-Silicon Via）连接多层晶粒。其中的“3D 集成 / 三维集成（Three-Dimensional Integration）”指三维垂直集成，即通过TSV等互连结构在垂直方向实现芯片层叠。“堆叠”指将逻辑与存储晶粒垂直层叠并键合。“加速器”加速机器学习工作负载中的矩阵与卷积运算。";
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [ "三维表示晶粒沿垂直方向集成", "堆叠表示多层晶粒键合", "加速器处理机器学习计算" ],
                requiredClaims: [ "分别解释三维、堆叠和加速对象" ],
                evidenceBoundaries: [ "不扩展到资料未说明的训练模型" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "核验 3D 与 ML 的规范中英文名称" ],
                entityType: "system",
                resolvedSense: "通过三维垂直集成加速机器学习工作负载的硬件系统"
            } ],
            generation: { status: "sufficient", body: badBody },
            verifications: [ validVerification() ],
            repair: prompt => {
                const segmentId = repairTargetSegment(prompt);
                const call = (segmentCalls.get(segmentId) ?? 0) + 1;
                segmentCalls.set(segmentId, call);
                if (segmentId === "seg-1") {
                    return {
                        status: "sufficient",
                        patches: [ {
                            operation: "replace",
                            segmentId,
                            text: call === 1
                                ? "3D堆叠ML 机器学习（Machine Learning）加速器通过TSV 硅通孔（Through-Silicon Via）连接多层晶粒。"
                                : "3D 三维（Three-Dimensional）堆叠的 ML 机器学习（Machine Learning）加速器通过垂直互连连接多层晶粒。"
                        } ]
                    };
                }
                return {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: "其中“三维”指晶粒沿垂直方向集成，并通过垂直互连连接各层。"
                    } ]
                };
            }
        });

        const title = "“3D堆叠ML加速器”在当前上下文中是什么意思？其中的3D、堆叠和加速器分别指什么？";
        const result = await generateReadWeaveAnswer({
            articleId: "repair-real-3d-ml",
            anchorId: "repair-real-3d-ml-anchor",
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ { id: "selected", role: "selected", text: badBody } ]
        });

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toContain("三维");
        expect(result.body).toContain("机器学习");
        expect(result.body).not.toMatch(/(?<![A-Za-z0-9])(?:3D|ML)(?![A-Za-z0-9])/u);
        expect(result.body).not.toMatch(/3D堆叠ML|3D 集成 \/ 三维集成/u);
        expect(findReadWeaveQualityIssues(result.body, title)).toEqual([]);
        expect(result.workflow).toMatchObject({ repairRounds: 0, validationPasses: 1 });
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(0);
    });

    it("repairs BUFFALO as a verified non-expandable method name instead of demanding a fictional expansion", async () => {
        let repairCalls = 0;
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [ "BUFFALO 是用于缓冲树生成的方法框架" ],
                requiredClaims: [ "说明该方法的对象类别和作用" ],
                evidenceBoundaries: [ "BUFFALO 的确切缩写全称在公开资料中未获官方确认" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "BUFFALO 是论文方法原名，没有可核验的正式英文展开式" ],
                entityType: "method",
                resolvedSense: "面向物理设计缓冲树生成的方法框架"
            } ],
            generation: {
                status: "sufficient",
                body: "BUFFALO 是用于物理设计缓冲树生成的方法框架，通过序列生成方式决定缓冲插入。"
            },
            verifications: [ validVerification() ],
            repair: prompt => {
                repairCalls += 1;
                const segmentId = repairTargetSegment(prompt);
                return repairCalls === 1
                    ? { status: "need_more_context", missing: "无法确认 BUFFALO 的英文展开" }
                    : {
                        status: "sufficient",
                        patches: [ {
                            operation: "replace",
                            segmentId,
                            text: "缓冲树生成框架（BUFFALO）是用于物理设计缓冲插入的方法，通过序列生成方式决定缓冲位置。"
                        } ]
                    };
            }
        });

        const title = "“BUFFALO”在当前上下文中是什么意思？";
        const result = await generateReadWeaveAnswer({
            articleId: "repair-buffalo",
            anchorId: "repair-buffalo-anchor",
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "BUFFALO 是论文提出的缓冲树生成框架；公开资料没有确认它具有可展开的正式英文全称。"
            } ]
        });

        expect(result.body).toContain("BUFFALO 是");
        expect(result.body).not.toContain("（BUFFALO）");
        expect(result.reviewIssues).toBeUndefined();
        expect(result.verifiedNonExpandableArtifact).toEqual({ originalName: "BUFFALO", entityType: "method" });
        expect(findReadWeaveQualityIssues(result.body, title, {
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
        })).toEqual([]);
        expect(repairCalls).toBe(0);
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(0);
    });

    it("applies successful parallel patches before expanding for a different evidence-starved segment", async () => {
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [ "系统先校验任务，再执行处理" ],
                requiredClaims: [ "说明校验和处理顺序" ],
                evidenceBoundaries: [ "资料没有说明失败恢复策略" ],
                ambiguities: [],
                canonicalEntityNeeds: []
            } ],
            generation: {
                status: "sufficient",
                body: "系统接收任务后先执行处理，并记录每一步的开始、运行与结束状态；系统随后处理失败恢复，并把可观察的处理结果写入任务状态记录。"
            },
            verifications: [ failedVerification(
                { segmentId: "seg-1", issue: "首句遗漏输入校验" },
                { segmentId: "seg-2", issue: "恢复策略缺少证据" }
            ) ],
            repair: prompt => repairTargetSegment(prompt) === "seg-1"
                ? {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId: "seg-1",
                        text: "系统接收任务后先校验任务输入，再执行处理，并记录每一步的开始、运行与结束状态。"
                    } ]
                }
                : { status: "need_more_context", missing: "缺少失败恢复策略" }
        });

        const result = await generateReadWeaveAnswer({
            articleId: "repair-partial-batch",
            anchorId: "repair-partial-batch-anchor",
            anchorType: "range",
            kind: "question",
            title: "系统按什么顺序处理任务？",
            fragments: [ { id: "selected", role: "selected", text: "系统先校验任务输入，再执行处理；资料没有说明失败恢复策略。" } ]
        });

        expect(result.body).toContain("先校验任务输入，再执行处理");
        expect(result.reviewIssues).toContain("缺少失败恢复策略");
        expect(result.workflow.repairRounds).toBe(1);
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(2);
    });

    it("keeps a successful parallel patch when another repair request throws and retries only the failed segment", async () => {
        const segmentCalls = new Map<string, number>();
        const progress: Array<{ message: string; issues?: string[] }> = [];
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [ "系统先校验输入，再执行任务，并记录结果" ],
                requiredClaims: [ "说明输入校验和结果记录" ],
                evidenceBoundaries: [ "不补充资料外的协议和性能" ],
                ambiguities: [],
                canonicalEntityNeeds: []
            } ],
            generation: {
                status: "sufficient",
                body: "系统接收任务后先检查输入内容是否完整，再依据既定顺序执行任务，并持续记录任务的开始状态和执行状态；任务完成后，系统保存最终结果，同时记录完成状态或失败状态，以便用户确认任务是否结束以及是否执行失败。"
            },
            verifications: [
                failedVerification(
                    { segmentId: "seg-1", issue: "输入检查应明确为校验" },
                    { segmentId: "seg-2", issue: "结果记录需要说明可观察状态" }
                ),
                validVerification()
            ],
            repair: prompt => {
                const segmentId = repairTargetSegment(prompt);
                const call = (segmentCalls.get(segmentId) ?? 0) + 1;
                segmentCalls.set(segmentId, call);
                if (segmentId === "seg-2" && call === 1) {
                    return { __httpStatus: 400, message: "scripted unusable patch" };
                }
                return {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: segmentId === "seg-1"
                            ? "系统接收任务后先校验输入内容是否完整，再依据既定顺序执行任务，并持续记录任务的开始状态和执行状态。"
                            : "任务完成后，系统保存最终结果，同时以完成状态或失败状态提供可观察记录，用户可据此确认任务是否结束以及是否执行失败。"
                    } ]
                };
            }
        });

        const result = await generateReadWeaveAnswer({
            articleId: "repair-one-worker-fails",
            anchorId: "repair-one-worker-fails-anchor",
            anchorType: "range",
            kind: "question",
            title: "系统如何处理任务并记录状态？",
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "系统接收任务后先校验输入，再执行任务；完成后保存结果，并记录完成状态或失败状态。"
            } ]
        }, update => progress.push(update));

        expect(result.body).toContain("先校验输入内容是否完整");
        expect(result.body).toContain("提供可观察记录");
        expect(result.reviewIssues).toBeUndefined();
        expect(segmentCalls).toEqual(new Map([ [ "seg-1", 1 ], [ "seg-2", 2 ] ]));
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(3);
        expect(result.workflow).toMatchObject({ repairRounds: 2, unchangedSegmentsVerified: true });
        expect(pipeline.remainingVerifications).toEqual([]);
        expect(progress.some(update => update.message.includes("成功补丁已保留")
            && update.issues?.some(issue => issue.includes("scripted unusable patch")))).toBe(true);
    });

    it("rejects a verifier claim that evidence-backed numeric facts are missing when the draft already contains them", async () => {
        const firstFact = "控制逻辑与功能单元的面积开销约为 10%";
        const secondFact = "专用电路的能效比较约为 500 倍，加入向量指令后约为 50 倍";
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [ firstFact, secondFact ],
                requiredClaims: [ "说明固定工作负载上的定制数据路径如何降低通用控制开销" ],
                evidenceBoundaries: [ "数字只适用于所述比较条件" ],
                ambiguities: [],
                canonicalEntityNeeds: []
            } ],
            generation: {
                status: "sufficient",
                body: "在所述固定工作负载中，控制逻辑与功能单元的面积开销约为 10%，因此更多资源可以用于直接执行目标运算；专用电路的能效比较约为 500 倍，加入向量指令后约为 50 倍，这些数值只适用于给定的比较条件，不能外推为所有应用的通用结论。"
            },
            verifications: [ failedVerification(
                { segmentId: "seg-1", issue: `证据计划中的必答数字事实未覆盖：${firstFact}` },
                { segmentId: "seg-2", issue: `证据计划中的必答数字事实未覆盖：${secondFact}` }
            ) ],
            repair: () => {
                throw new Error("A verifier omission contradicted by the draft must not reach targeted repair.");
            }
        });

        const result = await generateReadWeaveAnswer({
            articleId: "covered-numeric-verifier",
            anchorId: "covered-numeric-verifier-anchor",
            anchorType: "range",
            kind: "question",
            title: "这些设计选择为什么能在固定工作负载上提高资源利用率和能效？",
            fragments: [ {
                id: "selected",
                role: "selected",
                text: `在该固定工作负载中，${firstFact}；${secondFact}，这些数值不能外推到其他应用。`
            } ]
        });

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toContain("约为 10%");
        expect(result.body).toContain("约为 500 倍");
        expect(result.body).toContain("约为 50 倍");
        expect(result.workflow).toMatchObject({ repairRounds: 0, validationPasses: 1 });
        expect(pipeline.records.filter(record => record.kind === "repair")).toHaveLength(0);
        expect(pipeline.remainingVerifications).toEqual([]);
    });

    it("removes a four-paragraph web expansion and keeps only the qualitative ASIC answer requested by the user", async () => {
        const pipeline = installRepairPipeline({
            evidencePlans: [ {
                requiredFacts: [
                    "专用集成电路可以针对固定工作负载定制数据路径和存储结构",
                    "某视频单元的控制开销约为 10%",
                    "外部实验报告 500 倍与 50 倍能效差异",
                    "实验采用 45 nm 工艺"
                ],
                requiredClaims: [
                    "说明定制数据路径可能提高效率",
                    "说明设计成本和修改空间代价",
                    "用 2—3 个数量级扩展外部比较"
                ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: []
            } ],
            generation: {
                status: "sufficient",
                body: [
                    "专用集成电路面向固定工作负载定制数据路径和存储结构，因此可以把更多硬件资源直接用于目标运算并减少通用控制开销；这种效率优势依赖工作负载足够固定，代价是设计与验证成本更高，需求变化后能够修改功能的空间也更小。",
                    "在 45 nm 工艺下，某视频单元的控制开销约为 10%。",
                    "外部实验还报告约 3 倍、500 倍以及加入向量指令后约 50 倍的差异，并将其概括为 2—3 个数量级。",
                    "某技术研究所还讨论了它是否属于国家标准。"
                ].join("\n\n")
            },
            verifications: [
                {
                    valid: false,
                    needsMoreContext: false,
                    issues: [ "答案加入了证据计划未要求的技术研究所和国家标准信息" ],
                    repairs: [ {
                        operation: "replace",
                        segmentId: "seg-5",
                        issue: "答案加入了证据计划未要求的技术研究所和国家标准信息",
                        instruction: "删除整个外围片段"
                    } ]
                },
                validVerification()
            ],
            repair: prompt => ({
                status: "sufficient",
                patches: [ {
                    operation: "replace",
                    segmentId: repairTargetSegment(prompt),
                    text: ""
                } ]
            })
        });

        const result = await generateReadWeaveAnswer({
            articleId: "qualitative-asic-scope",
            anchorId: "qualitative-asic-scope-anchor",
            anchorType: "range",
            kind: "question",
            title: "专用集成电路与通用处理器相比为什么可能更高效，代价是什么？",
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "专用集成电路可以为固定工作负载定制数据路径和存储结构，把更多硬件资源直接用于目标运算并减少通用控制开销；这种优势依赖工作负载足够固定，但设计与验证成本高，需求变化后能够修改功能的空间小。"
            } ]
        });

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toBe("专用集成电路面向固定工作负载定制数据路径和存储结构，因此可以把更多硬件资源直接用于目标运算并减少通用控制开销；这种效率优势依赖工作负载足够固定，代价是设计与验证成本更高，需求变化后能够修改功能的空间也更小；");
        expect(result.body).not.toMatch(/45 nm|10%|3 倍|500 倍|50 倍|数量级|技术研究所|国家标准/u);
        expect(result.body.split("\n\n")).toHaveLength(1);
        expect(result.workflow.repairRounds).toBeGreaterThanOrEqual(2);
        expect(pipeline.remainingEvidencePlans).toEqual([]);
        expect(pipeline.remainingVerifications).toEqual([]);
    });
});
