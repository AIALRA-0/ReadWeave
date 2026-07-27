import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "placeholder"
    })
}));

import { findReadWeaveQualityIssues, generateReadWeaveAnswer } from "./readweave_ai.js";

interface ScriptedPipeline {
    webMemo: string;
    evidencePlan: Record<string, unknown>;
    generation: Record<string, unknown>;
    verifications: Array<Record<string, unknown>>;
    repair?: (prompt: string) => Record<string, unknown>;
}

interface RecordedRequest {
    url: string;
    text: string;
}

function installScriptedModel(script: ScriptedPipeline): {
    requests: RecordedRequest[];
    remainingVerifications: Array<Record<string, unknown>>;
} {
    const requests: RecordedRequest[] = [];
    const remainingVerifications = [ ...script.verifications ];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        requests.push({ url, text: body });

        if (url.endsWith("/anthropic/v1/messages")) {
            return Response.json({
                model: "deepseek-v4-pro",
                stop_reason: "end_turn",
                content: [
                    {
                        type: "web_search_tool_result",
                        content: [ { type: "web_search_result", url: "https://dl.acm.org/readweave" } ]
                    },
                    { type: "text", text: script.webMemo }
                ]
            });
        }

        if (!url.endsWith("/chat/completions")) throw new Error(`Unexpected scripted endpoint: ${url}`);
        const requestText = body;
        let content: Record<string, unknown>;
        if (requestText.includes("只建立完成任务所需的统一证据计划")) {
            content = script.evidencePlan;
        } else if (requestText.includes("只执行回答质量检查")) {
            const verification = remainingVerifications.shift();
            if (!verification) throw new Error("The scripted verifier response queue is empty.");
            content = verification;
        } else if (requestText.includes("只修复指定答案片段") && script.repair) {
            content = script.repair(completionPrompt({ url, text: requestText }));
        } else {
            content = script.generation;
        }
        return Response.json({
            model: "deepseek-v4-pro",
            choices: [ { message: { content: JSON.stringify(content) } } ]
        });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { requests, remainingVerifications };
}

function completionRequests(requests: RecordedRequest[], checkpoint: string): RecordedRequest[] {
    return requests.filter(request => request.url.endsWith("/chat/completions") && request.text.includes(checkpoint));
}

function completionPrompt(request: RecordedRequest): string {
    const payload = JSON.parse(request.text) as { messages: Array<{ content: string }> };
    return payload.messages.map(message => message.content).join("\n\n");
}

function repairTargetSegment(prompt: string): string {
    const serialized = prompt.split("仅允许的修复：", 2)[1]?.split("\n\n", 1)[0];
    if (!serialized) throw new Error("The repair prompt has no allowed-repair block.");
    const repairs = JSON.parse(serialized) as Array<{ segmentId?: unknown }>;
    const segmentId = repairs[0]?.segmentId;
    if (typeof segmentId !== "string") throw new Error("The repair prompt has no target segment.");
    return segmentId;
}

function validVerification(): Record<string, unknown> {
    return { valid: true, needsMoreContext: false, issues: [], repairs: [] };
}

function request(overrides: Pick<ReadWeaveGenerateRequest, "kind" | "title" | "fragments">): ReadWeaveGenerateRequest {
    return {
        articleId: "scripted-pipeline",
        anchorId: "scripted-anchor",
        anchorType: "range",
        ...overrides
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ReadWeave deterministic scripted full pipeline", () => {
    it("normalizes a terminated completion while preserving the raw cause for diagnostics", async () => {
        const transportError = new Error("terminated");
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            if (String(input).endsWith("/anthropic/v1/messages")) {
                return Response.json({
                    model: "deepseek-v4-pro",
                    stop_reason: "end_turn",
                    content: [
                        {
                            type: "web_search_tool_result",
                            content: [ { type: "web_search_result", url: "https://iupac.org/mercury" } ]
                        },
                        { type: "text", text: "Mercury 存在多个公开义项，当前选区没有提供消歧证据。" }
                    ]
                });
            }
            const response = Response.json({});
            vi.spyOn(response, "json").mockRejectedValue(transportError);
            return response;
        });
        vi.stubGlobal("fetch", fetchMock);

        let failure: unknown;
        try {
            await generateReadWeaveAnswer(request({
                kind: "term",
                title: "Mercury",
                fragments: [ {
                    id: "selected",
                    role: "selected",
                    text: "Mercury may refer to a planet, an element, a product, a project, or a person."
                } ]
            }));
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/ReadWeave 无法生成.*模型服务请求.*连接中断.*上下文与证据/u);
        expect((failure as Error).message).not.toContain("terminated");
        expect((failure as Error).cause).toBe(transportError);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("accepts FOOBAR only through an exact evidence-plan attestation instead of a product allowlist", async () => {
        const title = "FOOBAR 在当前布局语境中是什么方法？";
        const body = "通用布局框架（FOOBAR）是一种面向芯片布局约束求解的方法框架；它先建立元件位置与冲突约束，再迭代调整候选位置以减少布局冲突，其适用边界限于资料描述的布局优化任务。";
        const model = installScriptedModel({
            webMemo: "公开论文把 FOOBAR 作为方法原名使用，没有给出可核验的正式英文展开。来源：https://dl.acm.org/readweave",
            evidencePlan: {
                requiredFacts: [ "FOOBAR 通过位置约束减少布局冲突" ],
                requiredClaims: [ "说明该对象是布局方法框架及其适用边界" ],
                evidenceBoundaries: [ "FOOBAR 没有可核验的正式英文展开式" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "FOOBAR 是方法原名，不是可展开缩写" ],
                entityType: "method",
                resolvedSense: "面向芯片布局约束求解的方法框架"
            },
            generation: { status: "sufficient", body },
            verifications: [ validVerification() ]
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "question",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "FOOBAR 是论文提出的布局方法框架，通过位置约束减少元件冲突；论文没有声明可展开的英文全称。"
            } ]
        }));

        expect(result.body).toBe(body
            .replace("通用布局框架（FOOBAR）", "FOOBAR ")
            .replace(/\s{2,}/gu, " ")
            .replace(/。$/u, "；"));
        expect(result.reviewIssues).toBeUndefined();
        expect(result.verifiedNonExpandableArtifact).toEqual({ originalName: "FOOBAR", entityType: "method" });
        expect(findReadWeaveQualityIssues(body, title, {
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
        })).toContain("已核验的方法、系统或产品代号被错误放入英文全称括号；代号必须作为独立名称使用");
        expect(findReadWeaveQualityIssues(body, title)).toContain('缩写 FOOBAR 未使用“缩写 中文全称（英文全称）”格式');
        expect(completionRequests(model.requests, "只修复指定答案片段")).toHaveLength(0);
        expect(model.remainingVerifications).toEqual([]);
    });

    it("defines the non-expandable DPO-3D method through web, a resolved evidence plan, generation, and verification", async () => {
        const body = "DPO-3D 是一种针对三维集成电路电源分配网络的可微优化方法，通过协同处理可布线性与电压降目标完成设计优化，其适用边界限于该设计问题。";
        const model = installScriptedModel({
            webMemo: "DPO-3D 是论文采用的方法原名，公开资料没有确认可展开的英文全称。来源：https://dl.acm.org/readweave",
            evidencePlan: {
                requiredFacts: [
                    "DPO-3D 面向三维集成电路电源分配网络",
                    "DPO-3D 协同处理可布线性与电压降目标",
                    "该方法发表于 2025 年，论文题名为 Peripheral Metadata"
                ],
                requiredClaims: [
                    "说明它是可微电源分配网络优化方法",
                    "比较外围 ASIC 与 NRE 成本"
                ],
                evidenceBoundaries: [ "没有证据支持扩展到其他设计问题" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "确认 DPO-3D 是方法原名，不是可展开缩写" ],
                entityType: "method",
                resolvedSense: "面向三维集成电路电源分配网络的可微优化方法"
            },
            generation: {
                status: "sufficient",
                termIdentity: {
                    abbreviation: "DPO-3D",
                    chineseName: "面向三维集成电路的可微电源分配网络优化方法",
                    englishName: "DPO-3D"
                },
                body
            },
            verifications: [ validVerification() ]
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "term",
            title: "DPO-3D",
            fragments: [
                {
                    id: "selected",
                    role: "selected",
                    text: "DPO-3D 是一种面向三维集成电路电源分配网络的可微优化方法。"
                },
                {
                    id: "section",
                    role: "section",
                    text: "它协同处理可布线性与电压降目标；DPO-3D 是方法原名，没有公开确认的英文展开。"
                }
            ]
        }));

        expect(result.body).toBe(body.replace(/。$/u, "；"));
        expect(result.reviewIssues).toBeUndefined();
        expect(result.termIdentity).toEqual({
            abbreviation: undefined,
            chineseName: "面向三维集成电路的可微电源分配网络优化方法",
            englishName: undefined
        });
        expect(result.body).not.toMatch(/ASIC|NRE|2025|Peripheral Metadata/u);
        expect(result.body.split("\n\n")).toHaveLength(1);
        expect(result.webCalibration).toEqual({ used: true, sourceCount: 1, model: "deepseek-v4-pro" });
        expect(result.workflow).toMatchObject({ generationAttempts: 1, validationPasses: 1, repairRounds: 0 });
        expect(findReadWeaveQualityIssues(result.body, "在当前语境中，DPO-3D 是什么？", {
            kind: "term",
            subject: "DPO-3D",
            termIdentity: result.termIdentity
        })).toEqual([]);
        expect(completionRequests(model.requests, "只建立完成任务所需的统一证据计划")).toHaveLength(1);
        expect(completionRequests(model.requests, "只执行回答质量检查")).toHaveLength(1);

        const downstreamRequests = completionRequests(model.requests, "必须逐项覆盖且不得歪曲的证据计划");
        expect(downstreamRequests).toHaveLength(2);
        for (const downstreamRequest of downstreamRequests) {
            const prompt = completionPrompt(downstreamRequest);
            expect(prompt).toContain('"entityType":"method"');
            expect(prompt).toContain('"resolvedSense":"面向三维集成电路电源分配网络的可微优化方法"');
            expect(prompt).not.toMatch(/ASIC|NRE|2025|Peripheral Metadata/u);
        }
        expect(model.remainingVerifications).toEqual([]);
    });

    it("uses a section-level meeting clue to resolve a selected DAC token as the conference", async () => {
        const body = "DAC 设计自动化会议（Design Automation Conference）是聚焦电子设计自动化及芯片与系统设计研究交流的专业会议；当前语境中的名称指会议实体，而不是数模转换器。";
        const model = installScriptedModel({
            webMemo: "DAC 可指设计自动化会议；当前会议语境支持 Design Automation Conference。来源：https://dl.acm.org/readweave",
            evidencePlan: {
                requiredFacts: [ "相邻章节明确描述电子设计自动化学术会议" ],
                requiredClaims: [ "说明 DAC 在当前语境中是会议而不是转换器" ],
                evidenceBoundaries: [],
                ambiguities: [ "DAC 也可表示数模转换器" ],
                canonicalEntityNeeds: [ "核验会议的中英文规范名称" ],
                entityType: "conference",
                resolvedSense: "设计自动化会议"
            },
            generation: {
                status: "sufficient",
                termIdentity: {
                    abbreviation: "DAC",
                    chineseName: "设计自动化会议",
                    englishName: "Design Automation Conference"
                },
                body
            },
            verifications: [ validVerification() ]
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "term",
            title: "DAC",
            fragments: [
                { id: "selected", role: "selected", text: "DAC" },
                { id: "section", role: "section", text: "本节讨论电子设计自动化学术会议的论文交流环节。" }
            ]
        }));

        expect(result.reviewIssues).toBeUndefined();
        expect(result.termIdentity).toEqual({
            abbreviation: "DAC",
            chineseName: "设计自动化会议",
            englishName: "Design Automation Conference"
        });
        expect(result.body).toContain("专业会议");
        expect(result.body).not.toMatch(/数字模拟转换|Digital.to.Analog/iu);
        expect(result.context.fragmentIds).toContain("section");
        const evidenceRecord = completionRequests(model.requests, "只建立完成任务所需的统一证据计划")[0];
        expect(evidenceRecord).toBeDefined();
        const evidenceRequest = completionPrompt(evidenceRecord);
        expect(evidenceRequest).toContain("[selected:selected]\nDAC");
        expect(evidenceRequest).toContain("[section:section]\n本节讨论电子设计自动化学术会议");
        expect(model.remainingVerifications).toEqual([]);
    });

    it.each([
        {
            title: "ORCID",
            webMemo: "ORCID 的规范名称是 ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）。来源：https://orcid.org",
            identity: {
                abbreviation: "ORCID",
                englishName: "Open Researcher and Contributor ID"
            },
            generatedBody: "ORCID Open Researcher and Contributor ID 是一套为研究人员提供的持久数字标识符系统，通过分配给每位研究者一个唯一的 ORCID Open Researcher and Contributor ID iD（由 16 位数字组成），有效区分重名作者，并将其学术贡献、隶属关系等研究成果可靠地连接起来。",
            canonical: "ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）"
        },
        {
            title: "IEEE",
            webMemo: "IEEE 的规范名称是 IEEE 电气电子工程师学会（Institute of Electrical and Electronics Engineers）。来源：https://www.ieee.org",
            identity: {
                abbreviation: "IEEE",
                chineseName: "电气电子工程师学会",
                englishName: "Institute of Electrical and Electronics Engineers, Inc."
            },
            generatedBody: "电气电子工程师学会（Institute of Electrical and Electronics Engineers, Inc.）是面向电气、电子与计算技术领域的专业组织；IEEE 同时发布标准并组织专业交流。",
            canonical: "IEEE 电气电子工程师学会（Institute of Electrical and Electronics Engineers）"
        }
    ])("normalizes the first $title definition from structured identity before verification", async ({
        title,
        webMemo,
        identity,
        generatedBody,
        canonical
    }) => {
        const model = installScriptedModel({
            webMemo,
            evidencePlan: {
                requiredFacts: [ `${title} 具有当前文本描述的专业角色` ],
                requiredClaims: [ "说明对象类别、角色与适用边界" ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: [ `核验 ${title} 的规范身份` ],
                entityType: title === "ORCID" ? "identifier" : "organization",
                resolvedSense: title === "ORCID" ? "研究人员持久数字标识符系统" : "电气与电子技术专业组织"
            },
            generation: { status: "sufficient", termIdentity: identity, body: generatedBody },
            verifications: [ validVerification() ]
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "term",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: title === "ORCID"
                    ? "ORCID 为研究人员提供持久数字标识符，用于区分重名作者并连接研究成果。"
                    : "IEEE 制定技术规范、出版工程技术期刊并组织专业活动。"
            } ]
        }));

        expect(result.body.startsWith(canonical)).toBe(true);
        expect(result.body).not.toContain("Inc.");
        expect(result.reviewIssues).toBeUndefined();
        expect(result.termIdentity?.englishName).not.toMatch(/[.,，。;；:：!?！？]$/u);
        if (title === "ORCID") {
            expect(result.termIdentity).toEqual({
                abbreviation: "ORCID",
                chineseName: "开放研究者与贡献者标识符",
                englishName: "Open Researcher and Contributor ID"
            });
            expect(result.body.match(/Open Researcher and Contributor ID/gu)).toHaveLength(1);
            expect(result.body.match(/ORCID 开放研究者与贡献者标识符/gu)).toHaveLength(1);
            expect(result.body).not.toMatch(/\b(?:iD|ID)\b(?=\s*[（(])/u);
            expect(findReadWeaveQualityIssues(result.body, "在当前语境中，ORCID 是什么？", {
                kind: "term",
                subject: "ORCID",
                termIdentity: result.termIdentity,
                entityType: "identifier"
            })).toEqual([]);
        }
        expect(completionRequests(model.requests, "只修复指定答案片段")).toHaveLength(0);
    });

    it("does not treat H.264 identity digits as quantities and removes unrequested web performance numbers", async () => {
        const body = "ASIC 专用集成电路（Application-Specific Integrated Circuit）可为固定工作负载定制数据通路和存储结构，从而把能耗效率提高 2–3 个数量级（约 100–1000 倍）；视频编码专用方案每帧约 4 mJ，而通用处理器软件方案约 2023 mJ，差距超过 500 倍。目标运算通常可在一个时钟周期内完成，完整设计周期则为数月至一年并常以年计。代价是一次性工程费用高且制造后功能难以修改。";
        const scopedBody = "ASIC 专用集成电路（Application-Specific Integrated Circuit）可为固定工作负载定制数据通路和存储结构，从而减少通用控制开销；代价是一次性工程费用高且制造后功能难以修改。";
        const model = installScriptedModel({
            webMemo: "ASIC 专用集成电路（Application-Specific Integrated Circuit）的公开能效比较包含 H.264 视频编码案例。来源：https://dl.acm.org/readweave",
            evidencePlan: {
                requiredFacts: [ "ASIC 能耗效率可比通用处理器高 2–3 个数量级（约 100–1000 倍），例如 H.264 视频编码 ASIC 每帧能耗约 4 mJ，而 Intel 处理器优化软件方案约 2023 mJ，差距超 500 倍。" ],
                requiredClaims: [ "说明效率来源与工程代价" ],
                evidenceBoundaries: [ "数字只适用于相应工作负载与实现条件" ],
                ambiguities: [],
                canonicalEntityNeeds: [ "核验 ASIC 的规范名称" ]
            },
            generation: { status: "sufficient", body },
            verifications: [ validVerification() ],
            repair: prompt => {
                const segmentId = repairTargetSegment(prompt);
                return {
                    status: "sufficient",
                    patches: [ {
                        operation: "replace",
                        segmentId,
                        text: segmentId === "seg-1"
                            ? "ASIC 专用集成电路（Application-Specific Integrated Circuit）可为固定工作负载定制数据通路和存储结构，从而减少通用控制开销"
                            : ""
                    } ]
                };
            }
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "question",
            title: "ASIC 与通用处理器相比为什么可能更高效，代价是什么？",
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "ASIC 可为固定工作负载定制数据路径和存储结构，但设计成本高、功能修改空间小。"
            } ]
        }));

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toBe(scopedBody.replace(/。$/u, "；"));
        expect(result.body).not.toMatch(/2–3|100–1000|4 mJ|2023 mJ|500 倍|一个时钟周期|数月至一年|以年计/u);
        expect(completionRequests(model.requests, "只修复指定答案片段")).toHaveLength(3);
    });

    it("keeps quantitative QA on the shared pipeline with adaptive width and retries a contradictory verifier success", async () => {
        const body = "在同一框架和测量条件下，方案甲宽度为 12.4 毫米，方案乙为 9.1 毫米，因此甲高于乙 3.3 毫米（12.4 − 9.1 = 3.3 毫米）。这只说明记录中的宽度差异；现有证据没有提供成因，不能据此判断原因。";
        const contradictorySuccess = {
            valid: true,
            needsMoreContext: false,
            issues: [ "声称成功却仍携带问题" ],
            repairs: []
        };
        const model = installScriptedModel({
            webMemo: "公开校准未改变记录中的两项宽度测量。来源：https://dl.acm.org/readweave",
            evidencePlan: {
                requiredFacts: [ "方案甲宽度为 12.4 毫米", "方案乙宽度为 9.1 毫米" ],
                requiredClaims: [ "明确比较方向", "计算宽度差", "说明不能由宽度差判断成因" ],
                evidenceBoundaries: [ "记录没有提供差异成因" ],
                ambiguities: [],
                canonicalEntityNeeds: []
            },
            generation: { status: "sufficient", body },
            verifications: [ contradictorySuccess, validVerification() ]
        });

        const result = await generateReadWeaveAnswer(request({
            kind: "question",
            title: "在同一框架下，方案甲和方案乙的宽度有什么差异，能判断原因吗？",
            fragments: [{
                id: "measurements",
                role: "selected",
                text: "在同一框架和测量条件下，方案甲宽度为 12.4 毫米，方案乙宽度为 9.1 毫米；记录没有说明差异成因。"
            }]
        }));

        expect(result.reviewIssues).toBeUndefined();
        expect(result.body).toContain("甲高于乙 3.3 毫米");
        expect(result.body).toContain("12.4 − 9.1 = 3.3 毫米");
        expect(result.body.split("\n\n").length).toBeLessThanOrEqual(4);
        expect(result.workflow).toMatchObject({ generationAttempts: 1, validationPasses: 1, repairRounds: 0 });

        const evidenceRequests = completionRequests(model.requests, "只建立完成任务所需的统一证据计划");
        const verificationRequests = completionRequests(model.requests, "只执行回答质量检查");
        expect(evidenceRequests).toHaveLength(1);
        expect(evidenceRequests[0].text).toContain("问题回答和术语定义采用完全相同的抽取标准");
        expect(evidenceRequests[0].text).toMatch(/宽度与输出约束.*自适应.*机器上限为 4 段、5000 字/u);
        expect(verificationRequests).toHaveLength(2);
        const retryRequest = JSON.parse(verificationRequests[1].text) as { messages: Array<{ content: string }> };
        expect(retryRequest.messages.at(-1)?.content).toContain("A valid verification payload cannot contain issues");
        expect(retryRequest.messages.at(-1)?.content).toContain(`上一次 JSON：${JSON.stringify(contradictorySuccess)}`);
        expect(model.remainingVerifications).toEqual([]);
    });
});
