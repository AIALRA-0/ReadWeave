import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildReadWeaveDomainProfile } from "./readweave_domain_policy.js";

type BenchmarkCase = {
    name: string;
    question: string;
    kind?: ReadWeaveGenerateRequest["kind"];
    primaryDomain: string;
    requiredEvidence: string;
};

// This is a cheap routing benchmark, not a claim-accuracy score. It proves
// that the shared policy selects the right evidence contract before any paid
// provider is called. Provider recall/precision is measured separately with
// live credentials and must never be inferred from this fixture.
const cases: BenchmarkCase[] = [
    [ "Ada Lovelace 是谁？", "identity", "current-role" ],
    [ "Wuxi Li 当前任职于哪里？", "identity", "current-role" ],
    [ "谁是 Grace Hopper？", "identity", "current-role" ],
    [ "某研究员的个人简介是什么？", "identity", "current-role" ],
    [ "Lin Yibo 的教育背景和任职经历", "identity", "current-role" ],
    [ "Marie Curie 是什么人物？", "identity", "current-role" ],
    [ "DOI 是什么？", "definition", "definition" ],
    [ "什么是零信任安全？", "definition", "definition" ],
    [ "解释 ACID 的含义", "definition", "definition" ],
    [ "URL 的正式名称是什么？", "definition", "definition" ],
    [ "什么是流行病学？", "definition", "definition" ],
    [ "CDC 这个缩写是什么意思？", "definition", "definition" ],
    [ "这篇论文的 DOI 是什么？", "bibliographic", "doi" ],
    [ "10.1000/example 对应哪篇论文？", "bibliographic", "title" ],
    [ "这篇报告的正式出处是什么？", "bibliographic", "publisher" ],
    [ "作者和论文标题是否对应？", "bibliographic", "authorship" ],
    [ "这个标准的发布日期是什么？", "bibliographic", "title" ],
    [ "查找该研究的引用信息", "bibliographic", "title" ],
    [ "如何配置 Nginx 反向代理？", "procedure", "procedure-step" ],
    [ "怎么使用这个 API？", "procedure", "procedure-step" ],
    [ "安装步骤是什么？", "procedure", "procedure-step" ],
    [ "如何复现实验？", "procedure", "procedure-step" ],
    [ "这个流程的前置条件有哪些？", "procedure", "procedure-step" ],
    [ "怎样排查网页打不开？", "procedure", "procedure-step" ],
    [ "SRAM 和 DRAM 有什么区别？", "comparison", "comparison-dimension" ],
    [ "容器和虚拟机的差异是什么？", "comparison", "comparison-dimension" ],
    [ "比较两个数据库的优缺点", "comparison", "comparison-dimension" ],
    [ "Google 和 Bing 搜索结果有什么不同？", "comparison", "comparison-dimension" ],
    [ "两种算法的性能取舍是什么？", "comparison", "comparison-dimension" ],
    [ "这个方案和旧方案相比如何？", "comparison", "comparison-dimension" ],
    [ "增幅如何计算？", "calculation", "calculation-input" ],
    [ "概率是多少？", "calculation", "calculation-input" ],
    [ "为什么公式结果是负数？", "calculation", "calculation-input" ],
    [ "计算两个时间点之间的差值", "calculation", "calculation-input" ],
    [ "这个百分比是否算对了？", "calculation", "calculation-input" ],
    [ "根据输入数据求结果", "calculation", "calculation-input" ]
].map(([ question, primaryDomain, requiredEvidence ]) => ({
    name: question,
    question,
    primaryDomain,
    requiredEvidence
}));

describe("ReadWeave cross-domain evidence routing benchmark", () => {
    it(`routes all ${cases.length} fixed cases without calling a provider`, () => {
        for (const testCase of cases) {
            const profile = buildReadWeaveDomainProfile(
                { kind: testCase.kind ?? "question", title: testCase.question },
                testCase.question
            );
            expect(profile.primaryDomain, testCase.name).toBe(testCase.primaryDomain);
            expect(profile.requiredEvidenceTypes, testCase.name).toContain(testCase.requiredEvidence);
        }
    });
});
