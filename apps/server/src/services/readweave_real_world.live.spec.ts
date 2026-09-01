import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildReadWeaveTaskProfile, findReadWeaveQualityIssues, generateReadWeaveAnswer } from "./readweave_ai.js";

const describeLive = process.env.READWEAVE_LIVE_AI === "1" ? describe : describe.skip;

interface RealWorldCase {
    name: string;
    request: ReadWeaveGenerateRequest;
    expected: RegExp[];
    forbidden?: RegExp[];
}

function assertAccepted(result: ReadWeaveGenerateResponse, testCase: RealWorldCase): void {
    const profile = buildReadWeaveTaskProfile(testCase.request.kind, testCase.request.title);
    if (process.env.READWEAVE_PRINT_LIVE_BODY === "1") {
        console.info(`[real:${testCase.name}] accepted body:\n${result.body}`);
    }
    if (result.reviewIssues?.length) {
        throw new Error([
            `case=${testCase.name}`,
            `reviewIssues=${JSON.stringify(result.reviewIssues)}`,
            `body=${result.body}`,
            `termIdentity=${JSON.stringify(result.termIdentity)}`
        ].join("\n"));
    }
    if (result.webCalibration) expect(result.webCalibration.sourceCount).toBeGreaterThan(0);
    expect(result.usage).toMatchObject({ withinBudget: true });
    expect(result.usage!.modelCalls).toBeGreaterThanOrEqual(1);
    expect(result.usage!.modelCalls).toBeLessThanOrEqual(3);
    expect(result.usage!.costCny).toBeLessThanOrEqual(0.05);
    expect(result.workflow.unchangedSegmentsVerified).toBe(true);
    expect(result.body).not.toContain("。");
    expect(result.body).not.toMatch(/[（(][^（）()\n]{0,300}[（(]/u);
    expect(result.body).not.toMatch(/\.。|。。|\n{3,}/u);
    expect(result.body).not.toMatch(/(?:校验|检查|修复|搜索|检索)(?:失败|过程|结果|报错)/u);
    for (const pattern of testCase.expected) expect(result.body).toMatch(pattern);
    for (const pattern of testCase.forbidden ?? []) expect(result.body).not.toMatch(pattern);
    expect(findReadWeaveQualityIssues(result.body, testCase.request.title, {
        kind: testCase.request.kind,
        subject: profile.subject,
        knowledgeScope: profile.knowledgeScope,
        termIdentity: result.termIdentity,
        verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
    })).toEqual([]);
}

function request(
    name: string,
    kind: ReadWeaveGenerateRequest["kind"],
    title: string,
    selected: string,
    supporting?: string
): ReadWeaveGenerateRequest {
    return {
        articleId: "readweave-real-world-live",
        anchorId: `real-${name}`,
        anchorType: "range",
        kind,
        title,
        fragments: [
            { id: "selected", role: "selected", text: selected },
            ...(supporting ? [ { id: "section", role: "section" as const, text: supporting } ] : [])
        ]
    };
}

const REAL_WORLD_CASES: RealWorldCase[] = [
    {
        name: "bs-pdn-last-general-question-does-not-invent-expansion",
        request: request(
            "bs-pdn-last-general-question-does-not-invent-expansion",
            "question",
            "BS-PDN-Last是什么",
            "BS-PDN-Last:",
            [
                "BS-PDN-Last：面向具有多功能背面金属层的最优电源分配网络设计。",
                "原文题名为：BS-PDN-Last: Toward Optimal Power Delivery Network Design With Multifunctional Backside Metal Layers.。",
                "该论文发表于 IEEE Trans. Comput. Aided Des. Integr. Circuits Syst.，作者为 Min Gyu Park 和 Sung Kyu Lim，时间为 2025 年。"
            ].join("")
        ),
        expected: [ /BS-PDN-Last 是一种面向具有多功能背面金属层的最优电源分配网络设计方法/u, /方法/u, /电源分配网络/u ],
        forbidden: [
            /Backside Power Delivery Network/u,
            /（BS-PDN-Last）/u,
            /）\s*（/u,
            /BS-PDN-Last[^；\n]{0,80}(?:是|为)[^；\n]{0,80}缩写/u,
            /原文题名|发表于|作者为|Min Gyu Park|Sung Kyu Lim|2025|IEEE|先进方案|PDN-first|IR-drop|实验结果|性能提升|\d+\s*[%％]/u
        ]
    },
    {
        name: "dpo-3d-general-question-keeps-original-method-name",
        request: request(
            "dpo-3d-general-question-keeps-original-method-name",
            "question",
            "DPO-3D是什么",
            "DPO-3D",
            "DPO-3D：针对面对面3D IC中可布线性与IR压降权衡的柔性建模可微电源分配网络优化。原文题名为：DPO-3D: Differentiable Power Delivery Network Optimization for Face-to-Face 3D ICs。"
        ),
        expected: [ /DPO-3D 是一种针对面对面三维集成电路中可布线性与电压降权衡的柔性建模可微电源分配网络优化方法/u, /方法|优化/u ],
        forbidden: [ /（DPO-3D）|DPO-3D[^；\n]{0,80}(?:是|为)[^；\n]{0,80}缩写|原文题名|Differentiable Power Delivery|Face-to-Face 三维|梯度下降|不适用于其他封装|3D IC|IR压降/u ]
    },
    {
        name: "orcid-general-question-resists-local-test-use",
        request: request(
            "orcid-general-question-resists-local-test-use",
            "question",
            "ORCID是什么",
            "ORCID",
            "ORCID 0000-0002-2267-5282 被本测试文档用于拉取 Sung Kyu Lim 的公开书目，并测试 ReadWeave 的框选、下划线、角标、悬浮卡片和点击锁定。"
        ),
        expected: [ /ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）/u, /标识|研究者|作者/u, /区分|持久|唯一/u ],
        forbidden: [ /ReadWeave|测试|框选|下划线|角标|悬浮卡片|点击锁定|0000-0002-2267-5282/u ]
    },
    {
        name: "general-person-profile-resists-test-note-hijacking",
        request: request(
            "general-person-profile-resists-test-note-hijacking",
            "question",
            "“Sung Kyu Lim”是谁？",
            "本测试语料从 Sung Kyu Lim（ORCID 0000-0002-2267-5282）的公开书目中抽取近期题名，用于测试精确片段框选、名词定义、同一片段多个问题、定义嵌套、虚线下划线、角标、悬浮卡片和点击锁定；"
        ),
        expected: [
            /Sung Kyu Lim/u,
            /教授|学者|研究者/u,
            /南加州大学|University of Southern California|USC/iu,
            /EDA 电子设计自动化（Electronic Design Automation）/u,
            /芯片|集成电路|物理设计/u
        ],
        forbidden: [
            /ReadWeave|测试语料|框选|下划线|角标|悬浮卡片|点击锁定/u,
            /(?:现任|目前|当前|任教于)[^；\n]{0,40}(?:佐治亚理工|Georgia Institute of Technology)/iu,
            /电子设计自动化[（(]\s*电子设计自动化/u
        ]
    },
    {
        name: "acm-general-definition-resists-nearby-journal",
        request: request(
            "acm-general-definition-resists-nearby-journal",
            "term",
            "ACM",
            "一种用于高效物理设计参数调优的混合强化学习框架；该论文发表于 ACM Trans. Design Autom. Electr. Syst."
        ),
        expected: [ /ACM 美国计算机协会（Association for Computing Machinery）/u, /组织|学会|协会/u, /计算机|计算领域/u ],
        forbidden: [ /ACM 计算机学会设计自动化电子系统汇刊|在当前语境中|致心律|心肌|医学|另一独立概念|交流平台适用边界|等通过|制定行业标准|顶级会议|会议作为|是它通过/u ]
    },
    {
        name: "nested-pdn-definition",
        request: request(
            "nested-pdn-definition",
            "term",
            "PDN",
            "BS-PDN-Last 面向具有多功能背面金属层的最优电源分配网络设计；这里的 PDN 指向芯片各负载输送电源并控制电压降的电源分配网络。",
            "BS-PDN-Last 是论文方法原名，不是 PDN 的英文全称。PDN 的正式英文全称是 Power Delivery Network。"
        ),
        expected: [ /PDN 电源分配网络（Power Delivery Network）/u, /供电|电源/u, /压降|电源完整性/u ],
        forbidden: [
            /BS-PDN-Last [\p{Script=Han}]+（Power Delivery Network）/u,
            /PDN-Last 是|电压降电阻压降/u
        ]
    },
    {
        name: "tsv-definition",
        request: request(
            "tsv-definition",
            "term",
            "TSV",
            "三维集成电路通过 TSV 在垂直堆叠的晶粒之间传输电源与信号；TSV 是贯穿硅衬底的垂直互连结构。"
        ),
        expected: [ /TSV 硅通孔（Through-Silicon Via）/u, /垂直|硅/u, /互连|信号|电源/u ],
        forbidden: [ /Through Silicon Via/u ]
    },
    {
        name: "ppa-definition",
        request: request(
            "ppa-definition",
            "term",
            "PPA",
            "芯片物理设计通常联合优化 PPA，即功耗、性能与面积三个相互制约的设计指标。",
            "PPA 的标准英文展开为 Power, Performance, and Area。"
        ),
        expected: [ /PPA 功耗、性能与面积（Power, Performance, and Area）/u, /权衡|制约|指标/u ],
        forbidden: [ /价格|隐私|衡量面积|该对象三者|集成度在芯片|在该对象之间|系统级芯片（SoC）|全称为功耗、性能与面积|效率面积指|最优平衡/u ]
    },
    {
        name: "middle-of-line-definition",
        request: request(
            "middle-of-line-definition",
            "term",
            "MOL",
            "在该集成电路工艺语境中，MOL 位于晶体管形成之后、传统多层金属互连之前，负责连接器件端子与局部互连。",
            "该处 MOL 的正式英文全称是 Middle of Line，不表示木星轨道任务或其他同名对象。"
        ),
        expected: [ /MOL 中段制程（Middle of Line）|MOL 中间层制程（Middle of Line）|MOL 中段工艺（Middle of Line）/u, /晶体管|器件/u, /互连/u ],
        forbidden: [ /木星|任务|前段制程（前段制程|后段制程（后段制程|contact|摩尔|化学|mole/u ]
    },
    {
        name: "two-point-five-d-ic",
        request: request(
            "two-point-five-d-ic",
            "question",
            "2.5D IC 在这段话中指什么，它与真正的三维堆叠有什么区别？",
            "2.5D IC 把多个晶粒并排放置在带高密度互连的中介层上；真正的三维堆叠则把晶粒沿垂直方向直接堆叠并通过垂直互连连接。"
        ),
        expected: [ /2\.5D/u, /中介层/u, /并排|平面/u, /垂直|堆叠/u ],
        forbidden: [
            /(?<![.\d])5D/u,
            /五维/u,
            /2\.5 维集成电路（2\.5D Integrated Circuit）[\s\S]{1,400}2\.5 维集成电路（2\.5D Integrated Circuit）/u
        ]
    },
    {
        name: "quantitative-power-comparison",
        request: request(
            "quantitative-power-comparison",
            "question",
            "方案 A 和方案 B 的平均功耗谁更高，相差多少？",
            "在相同工作负载、相同电压与频率下，方案 A 的平均功耗为 120 mW，方案 B 的平均功耗为 95 mW。"
        ),
        expected: [ /方案 A[\s\S]{0,160}(?:高于|更高|高)|(?:高于|更高|高)[^。；]{0,100}方案 B/u, /25\s*mW/u ],
        forbidden: [ /没有可计算|无法比较|Plan A|Plan B|方案 [AB]（/u ]
    },
    {
        name: "causal-backside-pdn",
        request: request(
            "causal-backside-pdn",
            "question",
            "为什么把供电网络移到芯片背面可能降低电压降，但不能据此断言性能一定提高？",
            "背面供电可以缩短从电源凸点到晶体管的供电路径，并把部分正面布线资源留给信号网络。电压降还取决于电流、导体电阻、过孔结构和负载分布；这段材料没有给出频率或端到端性能测量。"
        ),
        expected: [ /路径/u, /电阻|电流/u, /电压降/u, /不能|不足|不代表|无法/u, /性能|频率|测量/u ],
        forbidden: [ /因此性能一定提高|所以性能必然提高/u ]
    },
    {
        name: "journal-punctuation",
        request: request(
            "journal-punctuation",
            "question",
            "这篇论文发表于什么期刊？请给出规范名称。",
            "该论文发表于 ACM Trans. Design Autom. Electr. Syst.，其正式期刊名为 ACM Transactions on Design Automation of Electronic Systems。"
        ),
        expected: [ /计算机学会设计自动化电子系统汇刊（ACM Transactions on Design Automation of Electronic Systems）/u ],
        forbidden: [ /\.。|Syst\.。|Trans\.。/u ]
    }
];

describeLive.concurrent("ReadWeave real-world DeepSeek acceptance matrix", () => {
    it.each(REAL_WORLD_CASES)("$name passes every internal and external acceptance gate", async testCase => {
        const startedAt = Date.now();
        const result = await generateReadWeaveAnswer(testCase.request, progress => {
            const issues = progress.issues.length ? ` | ${progress.issues.join("；")}` : "";
            console.info(`[real:${testCase.name}] +${Date.now() - startedAt}ms ${progress.stage}: ${progress.message}${issues}`);
        });
        assertAccepted(result, testCase);
    }, 600_000);
});
