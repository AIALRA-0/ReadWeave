import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn(async () => ({
    used: true,
    query: "direct evidence",
    sources: [ {
        provider: "Official documentation",
        title: "Authoritative source",
        url: "https://example.org/official",
        snippet: "This source directly supports the requested fact",
        publishedAt: "2026-08-01",
        score: 100
    } ],
    providers: [ "Official documentation" ],
    memo: "",
    warnings: [],
    elapsedMs: 1,
    cacheHit: false,
    searchCostCny: 0
})) }));

vi.mock("./readweave_search.js", () => ({ searchReadWeaveEvidence: searchMock }));
vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "placeholder"
    })
}));

import { formatReadWeaveBody, generateUnifiedReadWeaveAnswer } from "./readweave_unified_ai.js";

function request(title: string, kind: ReadWeaveGenerateRequest["kind"] = "question"): ReadWeaveGenerateRequest {
    return {
        articleId: "article",
        anchorId: "anchor",
        anchorType: "range",
        kind,
        title,
        optimizeQuestion: true,
        fragments: [
            { id: "selected", role: "selected", text: `${title} appeared in the current technical article` },
            { id: "nearby", role: "next", text: "Nearby text exists only for disambiguation" }
        ]
    };
}

function installModel(
    searchQueries: string[] = [ "authoritative direct evidence" ],
    generatedBody = "这是直接结论。它先说明对象本身，再解释必要机制与边界。"
) {
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = payload.messages.map(message => message.content).join("\n");
        let result: Record<string, unknown>;
        if (prompt.includes("统一问题分析器")) {
            result = {
                normalizedQuestion: "规范化后的原问题？",
                objective: "直接回答用户明确询问的命题",
                answerRequirements: [ "给出直接结论", "解释必要机制与边界" ],
                exclusions: [ "不复述文章已有句子" ],
                searchQueries,
                requiresCurrentEvidence: true
            };
        } else if (prompt.includes("统一质量审计器")) {
            result = { valid: true, issues: [], unsupportedClaims: [] };
        } else {
            result = {
                body: generatedBody,
                optimizedTitle: "规范化后的原问题？",
                termIdentity: { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" },
                claims: [ { claimId: "C1", text: "这是受到公开证据支持的直接结论", sourceIds: [ "S1" ], confidence: "high" } ],
                unresolvedClaims: []
            };
        }
        return Response.json({
            model: "deepseek-v4-flash",
            choices: [ { message: { content: JSON.stringify(result) } } ],
            usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
        });
    }));
}

describe("ReadWeave unified evidence workflow", () => {
    beforeEach(() => {
        searchMock.mockClear();
        installModel();
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([
        [ "人物资料", "Moongon Jung 是谁？", "question" ],
        [ "通用定义", "NPU", "term" ],
        [ "工作机制", "CXL.io 具体以什么形态工作？", "question" ]
    ] as const)("uses the same contract, evidence, writer and verifier for %s", async (_label, title, kind) => {
        const result = await generateUnifiedReadWeaveAnswer(request(title, kind));

        expect(result.audit?.workflowVersion).toBe("unified-evidence-v1");
        expect(result.audit?.questionContract.objective).toBe("直接回答用户明确询问的命题");
        expect(result.body).not.toContain("。");
        expect(result.body).toContain("直接结论");
        expect(result.evidenceSources).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceId: "S1", url: "https://example.org/official" })
        ]));
        expect(result.claims?.[0].sourceIds).toEqual([ "S1" ]);
        expect(result.reviewIssues).toBeUndefined();
        expect(result.usage?.withinBudget).toBe(true);
        expect(searchMock).toHaveBeenCalled();
    });

    it("repairs punctuation and paragraph length deterministically before saving", async () => {
        const result = await generateUnifiedReadWeaveAnswer(request("如何工作？"));

        expect(result.body).not.toMatch(/。|&#x|&#\d/u);
        expect(result.audit?.citationsVerified).toBe(true);
    });

    it("removes a repeated explanatory line before returning the answer", async () => {
        installModel(
            [ "authoritative direct evidence" ],
            "该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理\n该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理"
        );

        const result = await generateUnifiedReadWeaveAnswer(request("该协议是什么形态？"));

        expect(result.body).toBe("该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理");
    });

    it("runs all free evidence queries in parallel but permits only one paid fallback", async () => {
        installModel([ "primary authority", "independent corroboration", "current status" ]);

        await generateUnifiedReadWeaveAnswer(request("这个对象目前是什么状态？"));

        const calls = (searchMock.mock.calls as unknown as Array<[ { query: string; allowPaid: boolean } ]>)
            .map(([ options ]) => options);
        expect(calls.filter(call => call.allowPaid === false)).toHaveLength(3);
        expect(calls.filter(call => call.allowPaid === true)).toEqual([
            expect.objectContaining({ query: "primary authority" })
        ]);
    });

    it("keeps raw transport diagnostics out of the user-visible failure", async () => {
        const transportError = new Error("terminated");
        vi.stubGlobal("fetch", vi.fn(async () => { throw transportError; }));

        let failure: Error | undefined;
        try {
            await generateUnifiedReadWeaveAnswer(request("连接为什么中断？"));
        } catch (error) {
            failure = error as Error;
        }

        expect(failure).toBeDefined();
        expect(failure?.message).toContain("模型服务连接中断");
        expect(failure?.message).not.toContain("terminated");
        expect(failure?.cause).toBe(transportError);
    });

    it("does not release medium-confidence facts as a finished answer", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: "这个对象是什么？",
                    objective: "说明对象的身份",
                    answerRequirements: [ "给出对象身份" ],
                    exclusions: [],
                    searchQueries: [ "official identity" ],
                    requiresCurrentEvidence: true
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: "该对象的身份只有间接证据支持",
                        claims: [ { claimId: "C1", text: "身份只有间接证据支持", sourceIds: [ "S1" ], confidence: "medium" } ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        await expect(generateUnifiedReadWeaveAnswer(request("这个对象是谁？")))
            .rejects.toThrow("未达到高置信度");
    });

    it("enforces explicit scope exclusions even when the model verifier approves", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: "CXL.io 具体是什么形态？",
                    objective: "说明 CXL.io 的逻辑形态",
                    answerRequirements: [ "直接说明逻辑形态" ],
                    exclusions: [ "不展开内部标识符或相邻组件职责" ],
                    searchQueries: [ "CXL.io official specification" ],
                    requiresCurrentEvidence: false
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: "CXL.io 是一种逻辑协议\n\nCXL.io 的协议 ID 为 0xFFFF",
                        claims: [
                            { claimId: "C1", text: "CXL.io 是一种逻辑协议", sourceIds: [ "S1" ], confidence: "high" },
                            { claimId: "C2", text: "CXL.io 的协议 ID 为 0xFFFF", sourceIds: [ "S1" ], confidence: "high" }
                        ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        const result = await generateUnifiedReadWeaveAnswer(request("CXL.io 具体是什么形态？"));

        expect(result.body).toContain("具体形态是一组在链路上传输的输入/输出事务报文及其处理规则");
        expect(result.body).toContain("不是独立设备、芯片、插槽、线缆或物理接口");
        expect(result.body).not.toContain("0xFFFF");
        expect(result.claims?.every(claim => !claim.text.includes("0xFFFF"))).toBe(true);
    });

    it.each([
        {
            title: "HTTPS 如何保护通信？",
            generated: "HTTPS 使用 TLS/SSL 和 RSA 协商会话密钥，再用 MAC 算法检查完整性",
            mustContain: [
                "验证证书中的域名、有效期和签发链",
                "ECDHE 临时椭圆曲线迪菲—赫尔曼密钥交换（Ephemeral Elliptic Curve Diffie-Hellman）",
                "AEAD 带关联数据的认证加密（Authenticated Encryption with Associated Data）"
            ],
            mustNotContain: [ "TLS/SSL", "RSA 协商" ]
        },
        {
            title: "SQL 数据库和 NoSQL 数据库的核心区别是什么？",
            generated: "SQL 数据库只能垂直扩展；NoSQL 数据库通常不支持 ACID 事务，遵循 BASE，只能水平扩展",
            mustContain: [
                "核心区别是数据模型",
                "事务范围、一致性强度和扩展方式取决于具体产品与配置",
                "关系型与非关系型数据库也都可能横向或纵向扩展"
            ],
            mustNotContain: [ "通常不支持", "遵循 BASE", "只能垂直扩展", "只能水平扩展" ]
        },
        {
            title: "Sung Kyu Lim 是谁？",
            generated: "Sung Kyu Lim 是某大学教授；他的研究聚焦 2.5D 和 3D 集成电路；他是 IEEE Fellow；他于 1994、1997、2000 年分别获得学士、硕士和博士学位",
            mustContain: [ "南加州大学（University of Southern California）", "研究聚焦 EDA 电子设计自动化（Electronic Design Automation）", "领域级代表性贡献" ],
            mustNotContain: [ "2.5D", "IEEE Fellow", "1994", "1997", "2000", "学士", "硕士", "博士" ]
        }
    ])("uses evidence-reviewed safety answers for $title", async scenario => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: scenario.title,
                    objective: scenario.title,
                    answerRequirements: [ "直接回答" ],
                    exclusions: [],
                    searchQueries: [ scenario.title ],
                    requiresCurrentEvidence: true
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: scenario.generated,
                        claims: [ { claimId: "C1", text: scenario.generated, sourceIds: [ "S1" ], confidence: "high" } ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        const result = await generateUnifiedReadWeaveAnswer(request(scenario.title));
        for (const expected of scenario.mustContain) expect(result.body).toContain(expected);
        for (const forbidden of scenario.mustNotContain) expect(result.body).not.toContain(forbidden);
        if (scenario.title === "Sung Kyu Lim 是谁？") {
            expect(result.body).toContain("院长讲席教授（Dean's Professor）\n\n他的研究聚焦");
            expect(result.body).not.toContain("Professor）他的研究");
        }
        expect(result.body).not.toContain("。");
        expect(result.usage?.withinBudget).toBe(true);
    });

    it("fails closed before writing when every public evidence query is empty", async () => {
        searchMock.mockResolvedValueOnce({
            used: false,
            query: "missing evidence",
            sources: [],
            providers: [],
            memo: "",
            warnings: [],
            elapsedMs: 1,
            cacheHit: false,
            searchCostCny: 0
        });
        searchMock.mockResolvedValueOnce({
            used: false,
            query: "missing evidence",
            sources: [],
            providers: [],
            memo: "",
            warnings: [],
            elapsedMs: 1,
            cacheHit: false,
            searchCostCny: 0
        });

        await expect(generateUnifiedReadWeaveAnswer(request("完全无法核验的对象是什么？")))
            .rejects.toThrow("未取得可核验的公开来源");
    });
});

describe("ReadWeave natural paragraph formatting", () => {
    const readabilityCases = [
        [ "NPU 是什么？", "NPU 神经网络处理单元（Neural Processing Unit）是专门加速神经网络计算的处理器。" ],
        [ "DAX 是什么？", "DAX 直接访问（Direct Access）让程序绕过传统块设备缓存路径，直接访问持久内存。" ],
        [ "这项检查通过了吗？", "三项强制检查均已通过；当前结果可以进入下一轮人工确认。" ],
        [ "为什么网页打不开？", "域名解析服务没有返回目标服务器地址；浏览器因此无法建立连接；切换网络后恢复，说明故障更可能位于原网络的解析链路。" ],
        [ "什么是置信区间？", "置信区间是根据样本估计总体参数时给出的范围；区间宽度同时受到样本量、数据波动和置信水平影响；样本越少或波动越大，区间通常越宽。" ],
        [ "电池为什么会老化？", "充放电会反复改变电极材料的结构；副反应还会消耗可移动的锂离子；这些变化逐渐增加内部阻力并减少可用容量。" ],
        [ "缓存为什么能提速？", "缓存把近期或高频使用的数据放在更靠近处理器的位置；再次读取时不必等待较慢的主存或磁盘；命中率越高，平均等待时间通常越短。" ],
        [ "为什么要做备份？", "硬件损坏、误删除和勒索软件都可能让原始数据无法继续使用；独立备份保留另一份可恢复副本；备份只有经过恢复演练，才能证明它在事故中真正可用。" ],
        [ "HTTPS 如何保护通信？", "HTTPS 超文本传输安全协议（Hypertext Transfer Protocol Secure）先验证服务器证书，再协商本次连接使用的密钥；后续数据经过加密和完整性校验，旁观者难以读取或悄悄篡改内容；它保护传输过程，但不能证明网站提供的业务本身可信。" ],
        [ "数据库索引为什么会占空间？", "索引需要另外保存键值及其对应的数据位置；数据库更新记录时还要同步维护这些结构；索引能够减少查询扫描量，但过多索引会增加存储占用并拖慢写入。" ],
        [ "为什么总体趋势会反转？", "不同分组的样本比例可能差异很大；合并数据时，样本较多的分组获得更高权重；如果分组条件同时影响结果，总体趋势就可能与每个分组内部的趋势相反，这种现象称为辛普森悖论。" ],
        [ "浮点数为什么有误差？", "计算机通常用有限位二进制表示实数；许多十进制小数无法被有限位二进制精确表达；每次运算产生的舍入误差还可能继续累积，因此涉及金额或严格比较时需要使用适合的数据类型和容差规则。" ],
        [ "容器和虚拟机有什么区别？", "容器共享宿主机内核，只隔离进程、文件和网络等运行环境；虚拟机则模拟完整硬件并运行独立操作系统；容器通常启动更快、占用更少，虚拟机通常提供更强的系统边界，实际选择取决于隔离要求和运行负载。" ],
        [ "量子纠缠是什么？", "量子纠缠表示多个量子系统共享一个不能拆成彼此独立状态的整体状态；测量其中一个系统会改变对整体状态的描述，并使各部分的测量结果呈现经典独立变量无法解释的关联；这种关联不能用来超光速传递可控信息。" ],
        [ "为什么模型会过拟合？", "模型容量相对训练数据过大时，模型不仅学习稳定规律，还可能记住噪声和偶然细节；训练误差因此继续下降，但面对新数据时表现变差；增加有效数据、限制模型复杂度和使用独立验证集都能帮助发现并减轻这一问题。" ],
        [ "什么是事务隔离？", "事务隔离规定并发事务在多大程度上能够看到彼此尚未完成的修改；隔离较弱可以提高并发能力，但可能出现脏读、不可重复读或幻读；隔离较强更接近串行执行，但会增加等待、冲突处理和系统开销。" ],
        [ "为什么需要电源完整性分析？", "芯片上的电流会经过具有电阻和电感的供电网络；负载快速变化时，局部电压可能下降或产生噪声；电压超出器件允许范围会造成时序错误甚至功能失效，因此设计阶段需要同时检查稳态压降和瞬态响应。" ],
        [ "三维芯片为什么散热更难？", "三维集成把多个有源层垂直堆叠，内部热源离散热器更远；不同层之间还会通过键合层和介质材料增加热阻；热量更容易在局部积聚，温度升高又会增加漏电和老化速度，因此布局、供电和散热结构必须联合优化。" ],
        [ "什么是拜占庭容错？", "拜占庭容错描述分布式系统在部分节点任意故障甚至发送矛盾消息时仍能达成一致的能力；系统需要通过多方通信和投票区分可接受结果；能够容忍的故障节点数量取决于协议假设、总节点数和网络条件。" ],
        [ "为什么相关性不能证明因果？", "两个变量同时变化，可能是一个导致另一个，也可能是共同原因同时影响两者；样本选择、测量方式和时间趋势也会制造表面相关；只有研究设计排除这些替代解释后，才能更可靠地判断因果关系。" ],
        [ "编译器如何优化循环？", "编译器先分析循环中的数据依赖，确认哪些运算能够安全移动、合并或并行执行；循环展开可以减少分支开销，向量化可以让一条指令处理多个数据；如果别名关系或边界条件无法证明安全，编译器就必须保留更保守的执行方式。" ],
        [ "神经网络为什么需要激活函数？", "只有线性变换的多层网络仍然等价于一次线性变换，无法表达复杂的非线性关系；激活函数在各层之间加入非线性，使网络能够组合出更复杂的决策边界；不同激活函数还会影响梯度传播、数值稳定性和训练速度。" ],
        [ "什么是零信任安全？", "零信任安全不因为设备位于内部网络就默认信任它；每次访问都要根据身份、设备状态、请求对象和当前风险重新验证；权限还应限制在完成当前任务所需的最小范围，从而缩小账号泄露或设备失陷后的影响。" ],
        [ "怎样判断一次性能优化是否有效？", "先固定硬件、软件版本、输入数据和测试方法，避免环境变化掩盖真实差异；再分别测量延迟、吞吐量、资源占用和结果正确性，并重复运行以观察波动；如果提升只出现在单一样本或以错误结果为代价，就不能认定优化已经稳定有效。" ]
    ] as const;

    it.each(readabilityCases)("keeps %s readable without decorative structure", (_question, answer) => {
        const formatted = formatReadWeaveBody(answer);
        const paragraphs = formatted.split(/\n{2,}/u);

        expect(formatted).not.toContain("。");
        expect(formatted).not.toMatch(/(?:^|\n\n)(?:核心结论|研究方向|主要贡献|工作原理)[:：]?/u);
        expect(paragraphs.length).toBeGreaterThanOrEqual(1);
        expect(paragraphs.length).toBeLessThanOrEqual(5);
        expect(paragraphs.every(paragraph => paragraph.length > 0 && !/[；，]$/u.test(paragraph))).toBe(true);
    });

    it("preserves deliberate natural paragraphs and splits only long dense prose", () => {
        const deliberate = formatReadWeaveBody("第一段直接回答问题\n\n第二段解释必要原因\n\n第三段说明适用边界");
        expect(deliberate.split(/\n{2,}/u)).toEqual([
            "第一段直接回答问题",
            "第二段解释必要原因",
            "第三段说明适用边界"
        ]);

        const dense = formatReadWeaveBody(Array.from({ length: 8 }, (_, index) => `第${index + 1}项事实说明一个可以独立核对的对象、原因和实际影响`).join("；"));
        const paragraphs = dense.split(/\n{2,}/u);
        expect(paragraphs.length).toBeGreaterThanOrEqual(2);
        expect(paragraphs.length).toBeLessThanOrEqual(5);
    });

    it("removes decorative paragraph labels without deleting their content", () => {
        expect(formatReadWeaveBody([
            "核心结论：CXL.io 是一组用于设备发现、初始化和配置的协议事务",
            "主要贡献：它让主机能够通过同一连接管理兼容设备",
            "证据与边界：它不是独立的物理接口，也不替代 CXL.cache 或 CXL.mem"
        ].join("\n\n"))).toBe([
            "CXL.io 是一组用于设备发现、初始化和配置的协议事务",
            "它让主机能够通过同一连接管理兼容设备",
            "它不是独立的物理接口，也不替代 CXL.cache 或 CXL.mem"
        ].join("\n\n"));
    });

    it("normalizes common scientific notation and inequalities to LaTeX without rewriting existing formulas", () => {
        expect(formatReadWeaveBody("1 纳米等于 10^-9 米；16 nm 等于 16×10^-9 米；当 x>=3 时继续；已有 $C_{pk}$ 保持不变"))
            .toBe("1 纳米等于 $10^{-9}$ 米；16 nm 等于 $16 \\times 10^{-9}$ 米；当 $x \\geq 3$ 时继续；已有 $C_{pk}$ 保持不变");
    });

    it("covers clearly different answer lengths instead of one repeated fixture shape", () => {
        const lengths = readabilityCases.map(([ , answer ]) => answer.length);
        const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
        const standardDeviation = Math.sqrt(lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length);

        expect(Math.min(...lengths)).toBeLessThan(50);
        expect(Math.max(...lengths)).toBeGreaterThan(120);
        expect(standardDeviation).toBeGreaterThan(20);
    });
});
