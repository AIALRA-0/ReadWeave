import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    buildReadWeaveTaskProfile,
    findReadWeaveQualityIssues,
    generateReadWeaveAnswer
} from "./readweave_ai.js";

const describeLive = process.env.READWEAVE_LIVE_AI === "1" ? describe : describe.skip;

interface PersonProfileCase {
    name: string;
    question: string;
    selected: string;
    expected: RegExp[];
    forbidden: RegExp[];
}

function request(testCase: PersonProfileCase): ReadWeaveGenerateRequest {
    return {
        articleId: "readweave-person-profile-live",
        anchorId: `person-${testCase.name}`,
        anchorType: "range",
        kind: "question",
        title: testCase.question,
        fragments: [ { id: "selected", role: "selected", text: testCase.selected } ]
    };
}

const CASES: PersonProfileCase[] = [
    {
        name: "sung-kyu-lim-stale-local-affiliation",
        question: "Sung Kyu Lim是谁？",
        selected: "Sung Kyu Lim 是佐治亚理工学院教授；本测试文档从他的论文中抽取题名，用来测试 ReadWeave。",
        expected: [ /Sung Kyu Lim/u, /教授|学者|研究者/u, /电子设计自动化|集成电路|物理设计/u ],
        forbidden: [ /ReadWeave|测试文档|论文题名|现任[^；\n]{0,40}佐治亚理工|当前[^；\n]{0,40}佐治亚理工|提升能效|降低延迟/u ]
    },
    {
        name: "moongon-jung-single-paper-trap",
        question: "Moongon Jung是谁？",
        selected: "Moongon Jung 是 2015 年论文《Design and Analysis of 3D-MAPS: A Many-Core 3D Processor with Stacked Memory》的合作者之一；该论文发表于 IEEE Trans. Computers；附近还出现 James Jung 与 Yeonwoong Eric Jung。",
        expected: [ /Moongon Jung/u, /资料不足|不足以|无法可靠确认|无法[^；\n]{0,40}可靠对应|研究者|学者|工程师/u ],
        forbidden: [ /2015|《|Trans\.|合作者之一|作者之一|该论文提出|James Jung|Yeonwoong Eric Jung|主要贡献[^；\n]{0,100}(?:三维|处理器)/iu ]
    },
    {
        name: "mongkol-ekpanyapong-local-paper-redundancy",
        question: "Mongkol Ekpanyapong是谁？",
        selected: "Mongkol Ekpanyapong 是论文《An Efficient Computation of Statistically Critical Sequential Paths Under Retiming》的作者之一；该论文发表于 2007 年 ASP-DAC 亚太设计自动化会议；当前文章已经介绍了这篇论文的方法。",
        expected: [
            /Mongkol Ekpanyapong/u,
            /亚洲理工学院|Asian Institute of Technology/u,
            /教授/u,
            /人工智能|机器学习|嵌入式系统|计算机体系结构|微电子|物理设计/u
        ],
        forbidden: [ /ASP-DAC|2007|《|该论文|这篇论文|发表|作者之一|合作者|An Efficient Computation|近期合作研究|2025|2026|原文/u ]
    },
    {
        name: "fei-fei-li-unrelated-local-paper",
        question: "Fei-Fei Li是谁？",
        selected: "Fei-Fei Li 的姓名出现在本段参考文献旁边；本文讨论的具体实验与她的完整人物资料无关。",
        expected: [ /Fei-Fei Li/u, /现任[^；\n]{0,80}斯坦福|斯坦福[^；\n]{0,80}(?:现任|教授)/u, /人工智能|计算机视觉/u ],
        forbidden: [ /本段|本文|参考文献|具体实验|曾担任[^；\n]{0,80}斯坦福大学计算机科学教授/u ]
    },
    {
        name: "ada-lovelace-historical-person",
        question: "Ada Lovelace是谁？",
        selected: "Ada Lovelace 的名字出现在一篇讨论现代编程语言的文章中。",
        expected: [ /Ada Lovelace/u, /数学家|计算|程序|分析机/u ],
        forbidden: [ /现任|目前任职|当前机构|现代编程语言的文章|奠定[^；\n]{0,60}基础/u ]
    },
    {
        name: "zhou-zhihua-chinese-name",
        question: "周志华是谁？",
        selected: "周志华的姓名出现在机器学习教材推荐列表中；当前段落没有提供人物履历。",
        expected: [ /周志华/u, /南京大学|人工智能|机器学习/u ],
        forbidden: [ /教材推荐列表|当前段落/u ]
    },
    {
        name: "invented-name-must-fail-closed",
        question: "Qzv Plectrum是谁？",
        selected: "Qzv Plectrum 是当前论文作者列表中的一个名字；文档没有提供机构、职位或个人主页。",
        expected: [ /Qzv Plectrum/u, /资料不足|不足以|无法可靠确认|不能可靠确认|无法[^；\n]{0,40}可靠对应/u ],
        forbidden: [ /教授|大学|研究方向|主要贡献|代表性贡献|论文题名/u ]
    }
];

describeLive("ReadWeave independent person-profile quality audit", () => {
    it.each(CASES)("$name produces an independent, evidence-bounded profile", async testCase => {
        const startedAt = Date.now();
        const result = await generateReadWeaveAnswer(request(testCase), progress => {
            const issues = progress.issues.length > 0 ? `；${progress.issues.join("；")}` : "";
            console.info(`[person:${testCase.name}] +${Date.now() - startedAt}ms ${progress.stage} ${progress.message}${issues}`);
        });
        console.info(`[person:${testCase.name}] body=${result.body}`);

        expect(result.reviewIssues ?? []).toEqual([]);
        expect(result.usage?.withinBudget).toBe(true);
        expect(result.usage?.costCny ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(0.05);
        expect(result.body).not.toContain("。");
        expect(result.body).not.toMatch(/(?:电子设计自动化|人工智能|集成电路)简称|简称(?=\s*(?:；|，|芯片|工具|系统|方法|$))/u);
        expect(result.body).not.toMatch(/(?:显著|明显|大幅|有效|尤其|特别是)\s*(?:；|\n|$)/u);
        for (const pattern of testCase.expected) expect(result.body).toMatch(pattern);
        for (const pattern of testCase.forbidden) expect(result.body).not.toMatch(pattern);

        const profile = buildReadWeaveTaskProfile("question", testCase.question);
        expect(findReadWeaveQualityIssues(result.body, testCase.question, {
            kind: "question",
            subject: profile.subject,
            knowledgeScope: profile.knowledgeScope,
            entityType: "person"
        })).toEqual([]);
    }, 600_000);
});
