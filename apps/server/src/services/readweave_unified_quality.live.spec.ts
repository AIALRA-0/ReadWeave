import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { findReadWeaveQualityIssues, generateReadWeaveAnswer } from "./readweave_ai.js";

const describeLive = process.env.READWEAVE_LIVE_AI === "1" ? describe : describe.skip;

interface DefinitionCase {
    title: string;
    selected: string;
    supporting?: string;
    extraFragments?: ReadWeaveGenerateRequest["fragments"];
    expected: RegExp[];
    forbidden?: RegExp[];
    expectedEnglishName?: string;
    expectNoEnglishName?: boolean;
    expectNoAbbreviation?: boolean;
}

function expectSharedQuality(result: ReadWeaveGenerateResponse): void {
    if (result.reviewIssues?.length) {
        throw new Error(`reviewIssues=${JSON.stringify(result.reviewIssues)}\nbody=${result.body}\ntermIdentity=${JSON.stringify(result.termIdentity)}`);
    }
    if (result.webCalibration) expect(result.webCalibration.sourceCount).toBeGreaterThan(0);
    expect(result.usage).toMatchObject({ withinBudget: true });
    expect(result.usage!.modelCalls).toBeGreaterThanOrEqual(1);
    expect(result.usage!.modelCalls).toBeLessThanOrEqual(3);
    expect(result.usage!.costCny).toBeLessThan(0.01);
    expect(result.workflow.validationPasses).toBeGreaterThan(0);
    expect(result.workflow.unchangedSegmentsVerified).toBe(true);
    expect(result.body).not.toMatch(/^(好的|当然|作为(?:一个)?人工智能)/u);
    expect(result.body).not.toMatch(/根据(?:上述|提供的|当前)?(?:上下文|材料|原文|资料)/u);
    expect(result.body).not.toMatch(/(?:检索|搜索|校准)(?:过程|结果|资料)/u);
    expect(result.body).not.toMatch(/\n{3,}/u);
    expect(result.body).not.toContain("。");
    expect(result.body).not.toMatch(/[（(][^（）()\n]{0,300}[（(]/u);
}

function expectFocusedDefinition(result: ReadWeaveGenerateResponse, testCase: DefinitionCase): void {
    expectSharedQuality(result);
    expect(result.body.length).toBeGreaterThan(35);
    expect(result.body.length).toBeLessThan(1_200);
    expect(result.body.split("\n\n").length).toBeLessThanOrEqual(2);
    for (const pattern of testCase.expected) expect(result.body).toMatch(pattern);
    for (const pattern of testCase.forbidden ?? []) expect(result.body).not.toMatch(pattern);
    if (testCase.expectedEnglishName) expect(result.termIdentity?.englishName).toBe(testCase.expectedEnglishName);
    if (testCase.expectNoEnglishName) expect(result.termIdentity?.englishName).toBeUndefined();
    if (testCase.expectNoAbbreviation) expect(result.termIdentity?.abbreviation).toBeUndefined();
    for (const fragment of testCase.extraFragments ?? []) {
        expect(result.context.fragmentIds).not.toContain(fragment.id);
    }
    expect(findReadWeaveQualityIssues(result.body, `在当前语境中，${testCase.title} 是什么？`, {
        kind: "term",
        subject: testCase.title,
        termIdentity: result.termIdentity,
        verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
    })).toEqual([]);
}

function definitionRequest(testCase: DefinitionCase): ReadWeaveGenerateRequest {
    return {
        articleId: "live-unified-quality",
        anchorId: `term-${testCase.title.replace(/[^A-Za-z0-9]+/g, "-").toLocaleLowerCase()}`,
        anchorType: "range",
        kind: "term",
        title: testCase.title,
        fragments: [
            { id: "selected", role: "selected", text: testCase.selected },
            ...(testCase.supporting ? [ { id: "section", role: "section" as const, text: testCase.supporting } ] : []),
            ...(testCase.extraFragments ?? [])
        ]
    };
}

const DEFINITION_CASES: DefinitionCase[] = [
    {
        title: "EDA",
        selected: "EDA 覆盖从硬件描述、逻辑综合、验证到布局布线的一系列芯片设计自动化方法与工具。",
        expected: [ /EDA 电子设计自动化（Electronic Design Automation）/u, /设计|验证|实现/u ],
        forbidden: [ /创办于|论文题名|DOI/iu ]
    },
    {
        title: "DAC",
        selected: "这项芯片物理设计工作将在 DAC 2026 的研究论文环节报告，语境是电子设计自动化学术会议。",
        expected: [ /DAC 设计自动化会议（Design Automation Conference）/u, /会议/u ],
        forbidden: [ /数模转换|数字模拟转换|Digital.to.Analog/iu ]
    },
    {
        title: "ISPD",
        selected: "该论文发表于 ISPD；语境中的 ISPD 指面向集成电路物理设计研究的国际学术研讨会。",
        expected: [ /ISPD 物理设计国际研讨会（International Symposium on Physical Design）/u, /会议|研讨会/u, /物理设计/u ],
        forbidden: [ /中文名称后裸露|Inc\./u ]
    },
    {
        title: "ISLPED",
        selected: "该论文发表于 ISLPED；语境中的 ISLPED 指聚焦低功耗电子与设计研究的国际学术研讨会。",
        expected: [ /ISLPED 国际低功耗电子与设计研讨会（International Symposium on Low Power Electronics and Design）/u, /会议|研讨会/u, /低功耗/u ],
        forbidden: [ /低功耗电子与设计国际研讨会/u ]
    },
    {
        title: "ICCAD",
        selected: "该论文发表于 ICCAD；语境中的 ICCAD 指计算机辅助设计与电子设计自动化研究领域的国际学术会议。",
        expected: [ /ICCAD 计算机辅助设计国际会议（International Conference on Computer-Aided Design）/u, /会议/u, /计算机辅助设计|电子设计自动化/u ],
        forbidden: [ /Computer Aided Design/u ]
    },
    {
        title: "IEEE",
        selected: "该技术规范由 IEEE 制定；IEEE 同时出版工程技术期刊并组织专业活动。",
        expected: [ /IEEE 电气电子工程师学会（Institute of Electrical and Electronics Engineers）/u, /组织|学会/u ],
        forbidden: [ /IEEE 是一种协议|IEEE 是一个标准/u ]
    },
    {
        title: "Sung Kyu Lim",
        selected: "Sung Kyu Lim 是佐治亚理工学院电子与计算机工程领域的教授，研究方向包括电子设计自动化与集成电路物理设计。",
        expected: [ /Sung Kyu Lim/u, /教授/u, /南加州大学|University of Southern California|USC/iu, /电子设计自动化|集成电路/u ],
        forbidden: [ /现任[^；\n]{0,40}佐治亚理工|任教于[^；\n]{0,40}佐治亚理工|获得学位于|出生于|论文清单|DOI/iu ]
    },
    {
        title: "ORCID",
        selected: "ORCID 为研究人员提供持久的数字标识符，用于区分重名作者并连接其研究成果。",
        expected: [ /ORCID 开放研究者与贡献者(?:标识符|身份识别码)（Open Researcher and Contributor ID）/u, /标识符|身份识别码/u, /区分|消歧|重名/u ],
        forbidden: [ /社交平台|引用次数/u ]
    },
    {
        title: "BS-PDN-Last",
        selected: "BS-PDN-Last 是论文提出的电源分配网络优化方法，面向具有多功能背面金属层的设计空间搜索。",
        supporting: "该方法优化背面供电结构及信号资源分配；BS-PDN-Last 是方法原名，论文没有把它声明为可展开缩写。",
        expected: [ /BS-PDN-Last/u, /方法/u, /电源分配网络|背面金属层/u ],
        forbidden: [ /（BS-PDN-Last）/u, /创办于|标准组织/u ],
        expectNoEnglishName: true,
        expectNoAbbreviation: true
    },
    {
        title: "DPO-3D",
        selected: "DPO-3D 是一种面向三维集成电路电源分配网络的可微优化方法，用于协同处理可布线性与电压降目标。",
        supporting: "DPO-3D 是论文方法原名，不存在经公开来源确认的英文展开；PDN 表示电源分配网络。",
        expected: [ /DPO-3D/u, /可微/u, /三维集成电路/u, /电源分配网络/u ],
        forbidden: [ /（DPO-3D）/u, /会议|组织/u ],
        expectNoEnglishName: true,
        expectNoAbbreviation: true
    },
    {
        title: "3D-MAPS",
        selected: "3D-MAPS 指三维大规模并行处理器与堆叠内存的设计方案，把处理器计算层与堆叠内存沿垂直方向集成。",
        supporting: "原文题名为 Design and Analysis of 3D-MAPS (3D Massively Parallel Processor with Stacked Memory)；这里的 3D-MAPS 不是人物、会议或组织。",
        expected: [
            /3D-MAPS 三维大规模并行处理器与堆叠内存（3D Massively Parallel Processor with Stacked Memory）/u,
            /三维|垂直/u,
            /处理器/u,
            /堆叠内存/u
        ],
        forbidden: [ /三维-\s*[（(]|3D\s+三维/u ],
        expectedEnglishName: "3D Massively Parallel Processor with Stacked Memory"
    },
    {
        title: "NPU",
        selected: "NPU 是面向神经网络工作负载的专用处理单元，重点加速矩阵乘法、卷积和张量运算。",
        expected: [ /NPU 神经网络处理单元（Neural Processing Unit）/u, /专用|加速/u, /矩阵|卷积|张量/u ],
        forbidden: [ /图形处理器就是|中央处理器就是/u ]
    },
    {
        title: "3D堆叠ML加速器",
        selected: "提升可扩展性与性能：面向灵活3D堆叠ML加速器的宏单元布局。",
        supporting: "原文题名为 Boosting Scalability and Performance: Macro Placement for Flexible 3D-Stacked ML Accelerators；该论文发表于 ASP-DAC。",
        extraFragments: [
            {
                id: "previous",
                role: "previous",
                text: "一种用于高效物理设计参数调优的混合强化学习框架；该论文发表于 ACM Trans. Design Autom. Electr. Syst。"
            },
            {
                id: "next",
                role: "next",
                text: "BS-PDN-Last 面向具有多功能背面金属层的最优电源分配网络设计；该论文发表于 IEEE Trans. Comput. Aided Des. Integr. Circuits Syst。"
            },
            {
                id: "document",
                role: "document",
                text: "同一测试文档还包含 MOL、TSV、PPA、DPO-3D、ICCAD、IEEE Access 和其他无关术语。"
            }
        ],
        expected: [ /三维/u, /堆叠|垂直/u, /机器学习/u, /加速器/u ],
        forbidden: [ /机器学习（机器学习）/u, /（(?:如|例如)/u, /ASP-DAC/u, /Macro Placement/u ]
    }
];

describeLive.concurrent("ReadWeave live unified definition matrix", () => {
    it.each(DEFINITION_CASES)("defines $title through the shared evidence and verification pipeline", async testCase => {
        const startedAt = Date.now();
        const result = await generateReadWeaveAnswer(definitionRequest(testCase), progress => {
            const issues = progress.issues.length ? ` | ${progress.issues.join("；")}` : "";
            console.info(`[live:${testCase.title}] +${Date.now() - startedAt}ms ${progress.stage}: ${progress.message}${issues}`);
        });
        expectFocusedDefinition(result, testCase);
    }, 420_000);
});

describeLive("ReadWeave live QA and definition parity", () => {
    it("uses the same quality gates while keeping QA broader than a focused definition", async () => {
        const fragments = [{
            id: "asic",
            role: "selected" as const,
            text: "ASIC 是针对特定应用设计的集成电路；与通用处理器相比，它可以为固定工作负载定制数据路径和存储结构，但设计成本高、功能修改空间小。"
        }];
        const [ definition, answer ] = await Promise.all([
            generateReadWeaveAnswer({
                articleId: "live-unified-quality",
                anchorId: "asic-definition",
                anchorType: "range",
                kind: "term",
                title: "ASIC",
                fragments
            }),
            generateReadWeaveAnswer({
                articleId: "live-unified-quality",
                anchorId: "asic-question",
                anchorType: "range",
                kind: "question",
                title: "ASIC 与通用处理器相比为什么可能更高效，代价是什么？",
                fragments
            })
        ]);

        expectSharedQuality(definition);
        expectSharedQuality(answer);
        if (process.env.READWEAVE_PRINT_LIVE_BODY === "1") {
            console.info(`[live:ASIC-definition] ${definition.body}`);
            console.info(`[live:ASIC-answer] ${answer.body}`);
        }
        expect(definition.body).toMatch(/ASIC 专用集成电路（Application-Specific Integrated Circuit）/u);
        expect(definition.body).toMatch(/特定应用|固定工作负载/u);
        expect(definition.body).not.toMatch(/优于通用(?:芯片|处理器)/u);
        expect(definition.body.split("\n\n").length).toBeLessThanOrEqual(2);
        expect(answer.body).toMatch(/数据(?:路径|通路)/u);
        expect(answer.body).toMatch(/(?:片上)?存储(?:结构)?/u);
        expect(answer.body).toMatch(/成本|投入|门槛|设计(?:与验证)?(?:代价|负担)/u);
        expect(answer.body).toMatch(/修改空间|灵活性|难以修改|无法修改|功能固化/u);
        expect(answer.body).not.toMatch(/一个时钟周期|数月(?:至|到)[一两二三四五六七八九十]?年|以年计/u);
        expect(answer.body.length).toBeGreaterThanOrEqual(Math.min(120, Math.floor(definition.body.length * 0.8)));
    }, 420_000);

    it("fails instead of inventing a meaning for an unresolved ambiguous selection", async () => {
        await expect(generateReadWeaveAnswer({
            articleId: "live-unified-quality",
            anchorId: "ambiguous-mercury",
            anchorType: "range",
            kind: "term",
            title: "Mercury",
            fragments: [{
                id: "selected",
                role: "selected",
                text: "The next section uses the word Mercury without identifying whether it is a planet, an element, a product, a project, or a person."
            }],
            characterBudget: 6_000
        })).rejects.toThrow(/无法生成|上下文|歧义|含义|证据/u);
    }, 420_000);
});

describeLive.concurrent("ReadWeave live mixed-name repair matrix", () => {
    it("repairs the real Chinese-adjacent 3D/ML name pattern before accepting the answer", async () => {
        const title = "“3D堆叠ML加速器”在当前上下文中是什么意思？其中的3D、堆叠和加速器分别指什么？";
        const result = await generateReadWeaveAnswer({
            articleId: "live-unified-quality",
            anchorId: "mixed-3d-ml",
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "3D堆叠ML加速器通过硅通孔或混合键合把逻辑与存储晶粒沿垂直方向集成，用于加速机器学习工作负载中的矩阵乘法、卷积与张量运算。这里的3D表示三维垂直集成，堆叠表示多层晶粒垂直键合。"
            } ]
        });

        expectSharedQuality(result);
        expect(result.body).not.toMatch(/3D堆叠ML|3D 集成\s*\/\s*三维集成/u);
        expect(result.body).toMatch(/三维/u);
        expect(result.body).toMatch(/堆叠|垂直/u);
        expect(result.body).toMatch(/机器学习|矩阵|卷积|张量/u);
        expect(findReadWeaveQualityIssues(result.body, title)).toEqual([]);
    }, 420_000);

    it("keeps BUFFALO as a non-expandable method name and never invents an acronym expansion", async () => {
        const title = "“BUFFALO”在当前上下文中是什么意思？";
        const result = await generateReadWeaveAnswer({
            articleId: "live-unified-quality",
            anchorId: "non-expandable-buffalo",
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "BUFFALO 是论文提出的缓冲树生成方法框架，把物理设计中的缓冲插入建模为序列生成任务；公开资料没有确认 BUFFALO 具有可展开的正式英文全称。"
            } ]
        });

        expectSharedQuality(result);
        expect(result.body).toMatch(/BUFFALO 是[^。；]{0,40}缓冲树/u);
        expect(result.body).not.toContain("（BUFFALO）");
        expect(result.body).not.toMatch(/BUFFALO [\p{Script=Han}]+（[A-Za-z][^)）]+）/u);
        expect(result.verifiedNonExpandableArtifact).toEqual({ originalName: "BUFFALO", entityType: "method" });
        expect(findReadWeaveQualityIssues(result.body, title, {
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
        })).toEqual([]);
    }, 420_000);

    it("answers the real IEEE Access venue question without inventing or duplicating publication names", async () => {
        const title = "“IEEE Access”在当前上下文中是什么意思？";
        const result = await generateReadWeaveAnswer({
            articleId: "live-unified-quality",
            anchorId: "ieee-access-venue",
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ {
                id: "selected",
                role: "selected",
                text: "样本 8 与样本 9 的论文发表于 IEEE Access；这里的 IEEE Access 指论文的发表期刊，不是算法、会议或技术标准。"
            } ]
        });

        expectSharedQuality(result);
        expect(result.body).toMatch(/电气电子工程师学会开放获取期刊（IEEE Access）/u);
        expect(result.body).toMatch(/期刊/u);
        expect(result.body).not.toMatch(/IEEE 电气电子工程师学会[^。；]{0,80}Access/u);
        expect(result.body).not.toMatch(/\.。|。。|英文名称格式|校验失败/u);
        expect(findReadWeaveQualityIssues(result.body, title)).toEqual([]);
    }, 420_000);
});
