import { describe, expect, it, vi } from "vitest";

import {
    applyReadWeaveFormatPatches,
    formatReadWeaveAnswerHeadings,
    formatReadWeaveCanonicalEntities,
    formatReadWeaveCodeCopies,
    formatReadWeaveDefinitionBlock,
    formatReadWeaveFullNameOpening,
    formatReadWeaveMarkdown,
    formatReadWeaveNameParentheses,
    numberReadWeaveAnswerHeadings,
    repairReadWeaveVerifiedNameCase,
    repairReadWeaveNanosecondUnit,
    formatReadWeavePersonNameOrder,
    formatReadWeaveTermReferences,
    groupReadWeaveFormatTargets,
    readWeaveDisplayFormulas,
    readWeaveFormatIssues,
    readWeaveNameReviewTargets,
    type ReadWeaveTermRepairTarget,
    repairReadWeaveConventionalTerms,
    repairReadWeaveFormat,
    repairReadWeaveFormatBatch,
    repairReadWeaveOptionalQualifiers } from "./readweave_format.js";
import { HUMAN_READABLE_CHINESE_STYLE_CONTRACT, READWEAVE_WRITING_SKILL_REVISION } from "./readweave_style_contract.js";
import { readWeaveWritingSkill } from "./readweave_writing_skill.js";

describe("occurrence-scoped term meanings", () => {
    const term = (target: ReadWeaveTermRepairTarget, chineseName: string, englishName: string) => ({
        occurrenceId: target.occurrenceId, token: target.token, chineseName, englishName,
        confidence: "high", basis: "established-usage", contextReason: "The supplied occurrence context identifies this meaning"
    });

    it.each([
        ["IP", "IP 传输网络数据；IP 可授权给芯片设计公司", "网际协议", "Internet Protocol", "知识产权", "Intellectual Property"],
        ["GP", "GP 接诊患者；GP 优化芯片线长", "全科医生", "General Practitioner", "全局布局", "Global Placement"]
    ])("resolves each %s occurrence in one batch even when responses arrive in reverse order", async (token, body, firstChinese, firstEnglish, secondChinese, secondEnglish) => {
        const resolve = vi.fn(async (targets: ReadWeaveTermRepairTarget[], context) => {
            expect(targets.map(target => target.token)).toEqual([token, token]);
            expect(new Set(targets.map(target => target.occurrenceId)).size).toBe(2);
            expect(targets[0].before).toBe("");
            expect(targets[1].before).toContain("；");
            expect(context).toEqual({ question: "比较这两种用法", articleContext: body });
            return [term(targets[1], secondChinese, secondEnglish), term(targets[0], firstChinese, firstEnglish)];
        });
        const result = await repairReadWeaveConventionalTerms(body, "比较这两种用法", resolve, undefined, body);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(result.body).toContain(`${token} ${firstChinese}（${firstEnglish}）`);
        expect(result.body).toContain(`${token} ${secondChinese}（${secondEnglish}）`);
        expect(result.warnings).toEqual([]);
    });

    it("never applies one occurrence's response to an unanswered occurrence", async () => {
        const result = await repairReadWeaveConventionalTerms("GP 接诊患者；GP 优化芯片线长", "两种用法", async targets =>
            [term(targets[0], "全科医生", "General Practitioner")]);
        expect(result.body).toBe("GP 全科医生（General Practitioner）接诊患者；GP 优化芯片线长");
        expect(result.warnings).toHaveLength(1);
    });

    it.each(["missing", "duplicate", "wrong-token", "unknown-id", "numeric-id"])("rejects %s occurrence attribution", async mode => {
        const body = "GP 接诊患者；GP 优化芯片线长";
        const result = await repairReadWeaveConventionalTerms(body, "两种用法", async targets => {
            const answer = term(targets[0], "全科医生", "General Practitioner");
            if (mode === "duplicate") return [answer, answer];
            if (mode === "wrong-token") return [{ ...answer, token: "IP" }];
            if (mode === "unknown-id") return [{ ...answer, occurrenceId: "not-an-input-occurrence" }];
            if (mode === "numeric-id") return [{ ...answer, occurrenceId: 0 }];
            return [{ ...answer, occurrenceId: undefined }];
        });
        expect(result.body).toBe(body);
        expect(result.knowledgeTerms).toEqual([]);
        expect(result.warnings).toHaveLength(2);
    });

    it.each([
        "IP（Intellectual Property）可授权复用", "IP 知识产权（Intellectual Property）可授权复用",
        "IP知识产权（Intellectual Property）可授权复用", "IP 知识产权(Intellectual Property)可授权复用"
    ])("protects an explicit alternate label while resolving a separate bare token: %s", async alternate => {
        const resolve = vi.fn(async (targets: ReadWeaveTermRepairTarget[]) => {
            expect(targets).toHaveLength(1);
            return [term(targets[0], "网际协议", "Internet Protocol")];
        });
        const result = await repairReadWeaveConventionalTerms(`IP 负责网络传输；${alternate}`, "比较用法", resolve);
        expect(result.body).toBe(`IP 网际协议（Internet Protocol）负责网络传输；${alternate}`);
        expect(result.warnings).toEqual([]);
    });

    it.each([
        ["IP", "知识产权", "网际协议", "Internet Protocol"],
        ["GP", "全局布局", "全科医生", "General Practitioner"]
    ])("does not replace the supplied Chinese identity of %s with another occurrence's meaning", async (token, suppliedChinese, wrongChinese, wrongEnglish) => {
        const alternate = `${suppliedChinese}（${token}）用于芯片设计`;
        const result = await repairReadWeaveConventionalTerms(`${token} 有另一种用法；${alternate}`, "比较用法", async targets =>
            targets.map(target => term(target, wrongChinese, wrongEnglish)));
        expect(result.body).toContain(alternate);
        expect(result.warnings).toHaveLength(1);
    });

    it("leaves explicit Power BI and Linux DAX names intact without choosing a catalog meaning", async () => {
        const body = "Power BI 中 DAX（Data Analysis Expressions）用于度量值；Linux 中 DAX 直接访问（Direct Access）绕过页缓存";
        const resolve = vi.fn(async (_targets: ReadWeaveTermRepairTarget[]) => []);
        const result = await repairReadWeaveConventionalTerms(body, "比较两种 DAX", resolve);
        expect(result.body).toBe(body);
        expect(resolve.mock.calls.flatMap(([targets]) => targets).some(target => target.token === "DAX")).toBe(false);
    });

    it("protects a named artifact when an unprotected occurrence of the same token is resolved", async () => {
        const body = "GP 接诊患者；GP Practice 是本文引用的书名";
        const result = await repairReadWeaveConventionalTerms(body, "说明用法", async targets => {
            expect(targets).toHaveLength(1);
            return [term(targets[0], "全科医生", "General Practitioner"),
                { ...term(targets[0], "全科医生", "General Practitioner"), occurrenceId: `term-${body.lastIndexOf("GP")}` }];
        }, undefined, body, ["GP Practice", ""]);
        expect(result.body).toBe("GP 全科医生（General Practitioner）接诊患者；GP Practice 是本文引用的书名");
    });

    it("checks the entire replacement span against protected names at apply time", async () => {
        const body = "知识产权（IP）用于保护创作成果";
        const result = await repairReadWeaveConventionalTerms(body, "说明用法", async targets => {
            expect(targets).toHaveLength(1); // The token is outside the protected Chinese name.
            return [term(targets[0], "知识产权", "Intellectual Property")];
        }, undefined, body, ["知识产权"]);
        expect(result.body).toBe(body);
        expect(result.knowledgeTerms).toEqual([]);
    });

    it("protects literal names before generic name-order normalization too", async () => {
        const body = "3D IC 是这里指定的原始产品名";
        const resolve = vi.fn();
        expect((await repairReadWeaveConventionalTerms(body, "说明名称", resolve, undefined, body, ["3D IC"])).body).toBe(body);
        expect(resolve).not.toHaveBeenCalled();
    });

    it("does not treat a token-only response as unique when another explicit occurrence exists", async () => {
        const body = "IP 负责传输；IP（Intellectual Property）指知识产权";
        const result = await repairReadWeaveConventionalTerms(body, "两种用法", async targets =>
            [{ ...term(targets[0], "网际协议", "Internet Protocol"), occurrenceId: undefined }]);
        expect(result.body).toBe(body);
        expect(result.warnings).toHaveLength(1);
    });

    it("keeps every occurrence in the existing batch without a first-N cutoff", async () => {
        const body = Array.from({ length: 25 }, (_, index) => `GP 用法${index}`).join("；");
        const resolve = vi.fn(async (targets: ReadWeaveTermRepairTarget[]) => targets.map(target => term(target, "全科医生", "General Practitioner")));
        const result = await repairReadWeaveConventionalTerms(body, "说明用法", resolve);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0][0]).toHaveLength(25);
        expect(result.body).toContain("全科医生用法24");
        expect(result.warnings).toEqual([]);
    });

    it("preserves literal and quoted occurrences alongside independently resolved prose", async () => {
        const opaque = ["`GP`", "> GP 接诊患者", "```text\nGP literal\n```", "[GP](https://example.com/GP)"];
        const body = `GP 接诊患者\n\n${opaque.join("\n\n")}`;
        const result = await repairReadWeaveConventionalTerms(body, "说明用法", async targets => {
            expect(targets).toHaveLength(1);
            return [term(targets[0], "全科医生", "General Practitioner")];
        });
        for (const literal of opaque) expect(result.body).toContain(literal);
    });

    it("does not let the later reference formatter assign a meaning to a bare alternate token", () => {
        const body = "IP 网际协议（Internet Protocol）负责传输；芯片设计中的 IP 可以授权复用";
        expect(formatReadWeaveTermReferences(body, { abbreviation: "IP", chineseName: "网际协议", englishName: "Internet Protocol" })).toBe(body);
    });

    it.each(["before", "during"])("honors cancellation %s the resolver without applying a response", async phase => {
        const controller = new AbortController();
        if (phase === "before") controller.abort();
        const resolve = vi.fn(async (targets: ReadWeaveTermRepairTarget[]) => {
            controller.abort();
            return [term(targets[0], "全科医生", "General Practitioner")];
        });
        await expect(repairReadWeaveConventionalTerms("GP 接诊患者", "说明用法", resolve, controller.signal)).rejects.toThrow();
        expect(resolve).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    });
});

describe("versioned formatting contract", () => {
    it("loads the complete bundled entry, formatting, explanation and formula rules", () => {
        const { prompt, revision } = readWeaveWritingSkill();
        expect(revision).toMatch(/^[a-f0-9]{64}$/u);
        for (const marker of [ "# 顶层格式规则", "# 零基础解释框架", "# 公式解释规则",
            "FMT-001", "FMT-121", "EXPL-001", "EXPL-014", "## 八、交付前复核",
            "不得混入中文别名、解释、追加的缩写、逗号、分隔符" ])
            expect(prompt).toContain(marker);
        expect(prompt).toContain("附带公式至少说明整体用途、首次符号、关键组分、结果含义和当前条件");
    });
    it("splits independent long reasons while preserving each complete statement", () => {
        const source = "同时存在两类固定开销：线程之间的同步与通信随线程数增加而增长，全局归约、原子操作和缓存一致性开销会抵消一部分并行收益；此外线程数增加会加剧内存带宽与访存的竞争，使得每个线程的有效吞吐下降";
        expect(readWeaveFormatIssues(source)).toContain("FMT-036：两个以上独立原因或事实需要分行，不能以分号挤在同一行");
        const formatted = formatReadWeaveMarkdown(source);
        expect(formatted).toContain("\n- 线程之间的同步与通信");
        expect(formatted).toContain("\n- 此外线程数增加");
        expect(readWeaveFormatIssues(formatted)).not.toContain("FMT-036：两个以上独立原因或事实需要分行，不能以分号挤在同一行");
        expect(formatReadWeaveMarkdown("盒盖关紧后，外面的水汽较难进入，盒内物品更不容易受潮"))
            .not.toContain("\n- ");
    });
    it("splits counted short reasons but keeps a continuous definition intact", () => {
        const source = "成本分两部分：计算消耗随规模增加；通信开销也逐步上升";
        expect(readWeaveFormatIssues(source)).toContain("FMT-036：两个以上独立原因或事实需要分行，不能以分号挤在同一行");
        expect(formatReadWeaveMarkdown(source)).toBe("成本分两部分：\n\n- 计算消耗随规模增加\n- 通信开销也逐步上升");
        const definition = "算法（Algorithm）：输入一些数据；经过有限步骤得到结果";
        expect(formatReadWeaveMarkdown(definition)).not.toContain("\n- ");
    });
    it("removes accidental spaces between Chinese words without touching protected content", () => {
        const source = "神经网络处理单元 则只针对神经网络算子优化；神经网络处理单元 牺牲通用性；和 图形处理器不同\n\n`处理单元 则`";
        expect(readWeaveFormatIssues(source)).toContain("FMT-048：连续中文词语之间存在多余空格");
        expect(formatReadWeaveMarkdown(source)).toBe("神经网络处理单元则只针对神经网络算子优化；神经网络处理单元牺牲通用性；和图形处理器不同\n\n`处理单元 则`");
    });
    it("keeps official punctuation but reports appended acronyms and ordinary lowercase labels", () => {
        expect(readWeaveFormatIssues("加州大学洛杉矶分校（University of California, Los Angeles）"))
            .not.toContain("FMT-121：英文名称括号不能混入缩写、别名或分隔说明，须核对已有名称而非编造展开");
        expect(readWeaveFormatIssues("加州大学洛杉矶分校（University of California, Los Angeles, UCLA）"))
            .toContain("FMT-121：英文名称括号不能混入缩写、别名或分隔说明，须核对已有名称而非编造展开");
        expect(readWeaveFormatIssues("代码仓库（repository）；全局布局（global placement）"))
            .toContain("FMT-062：普通双语术语标签的英文名称需要核对标题式大小写与官方拼写");
        expect(readWeaveFormatIssues("代码仓库（Repository）；全局布局（Global Placement）"))
            .not.toContain("FMT-062：普通双语术语标签的英文名称需要核对标题式大小写与官方拼写");
    });
    it("moves only a mixed nanosecond gloss out of parentheses and preserves the accepted lowercase unit name", () => {
        const mixed = "动态检查覆盖 10 ns（纳秒， Nanosecond）的工作时间窗";
        const canonical = "动态检查覆盖 10 ns 纳秒（nanosecond）的工作时间窗";
        expect(repairReadWeaveNanosecondUnit(mixed)).toBe(canonical);
        expect(repairReadWeaveNanosecondUnit(canonical)).toBe(canonical);
        expect(repairReadWeaveNanosecondUnit("动态检查覆盖 10 ns 纳秒（Nanosecond）的工作时间窗")).toBe(canonical);
        expect(repairReadWeaveNanosecondUnit("`10 ns（纳秒， Nanosecond）`\n\n> 10 ns（纳秒， Nanosecond）"))
            .toBe("`10 ns（纳秒， Nanosecond）`\n\n> 10 ns（纳秒， Nanosecond）");
        expect(readWeaveFormatIssues(canonical).some(issue => issue.startsWith("FMT-062"))).toBe(false);
        expect(repairReadWeaveVerifiedNameCase(canonical, [ { canonical: "纳秒（Nanosecond）" } ]).body).toBe(canonical);
    });
    it("numbers every generated heading with a trailing dot without touching literal source", () => {
        const body = "## 1 原理\n\n正文\n\n### 1.1 符号\n\n解释\n\n### 示例\n\n> ## 引文标题\n\n```md\n## 代码标题\n```";
        const result = numberReadWeaveAnswerHeadings(body);
        expect(result).toContain("## 1. 原理");
        expect(result).toContain("### 1.1. 符号");
        expect(result).toContain("### 1.2. 示例");
        expect(result).toContain("> ## 引文标题");
        expect(result).toContain("```md\n## 代码标题\n```");
        expect(numberReadWeaveAnswerHeadings(result)).toBe(result);
        expect(readWeaveFormatIssues(body)).toContain("FMT-032：所有生成标题须使用以点号结尾的连续层级编号");
        expect(readWeaveFormatIssues(result)).not.toContain("FMT-032：所有生成标题须使用以点号结尾的连续层级编号");
    });
    it("corrects only names already verified in the outline", () => {
        const source = "供电网络占用比例（power delivery network occupancy ratio）与 dblp 计算机科学文献数据库（dblp computer science bibliography）";
        const terms = [ {canonical:"供电网络占用比例（Power Delivery Network Occupancy Ratio）"},
            {canonical:"dblp 计算机科学文献数据库（dblp computer science bibliography）"} ];
        const result = repairReadWeaveVerifiedNameCase(source, terms);
        expect(result.body).toContain("供电网络占用比例（Power Delivery Network Occupancy Ratio）");
        expect(result.body).toContain("dblp computer science bibliography");
        expect(result.count).toBe(1);
        expect(repairReadWeaveVerifiedNameCase(result.body, terms).count).toBe(0);
    });
    it("reports a complex formula whose symbols or operators are unexplained", () => {
        const formula = "$$\\min(\\sum_{e\\in E} WL(e;x,y))+\\lambda D(x,y)$$";
        expect(readWeaveFormatIssues(`${formula}\n\n其中 WL 是线长函数，D 是密度惩罚`))
            .toContain("EXPL-010/FMT-070：公式缺少首次符号、关键组分或运算关系的就近解释");
        expect(readWeaveFormatIssues("```tex\n$$\\min(\\sum_{e\\in E} WL(e;x,y))+\\lambda D(x,y)$$\n```"))
            .not.toContain("EXPL-010/FMT-070：公式缺少首次符号、关键组分或运算关系的就近解释");
    });
    it("only locates rendered formulas, never quoted or literal math", () => {
        const source = ["```tex", "$$\\sum_{i=1}^{n} i$$", "```", "",
            "> $$\\min x$$", "", "正文 $$\\lambda x$$ 的解释"].join("\n");
        const formulas = readWeaveDisplayFormulas(source);
        expect(formulas.map(item => item.formula)).toEqual([ "$$\\lambda x$$" ]);
        expect(source.slice(formulas[0].start, formulas[0].end)).toBe(formulas[0].formula);
    });
    it("repairs every independent failing span in one local batch without changing facts", async () => {
        const original = "第一句。\n\n第二句。\n\n第三句。";
        const repair = vi.fn(async (targets: Array<{ start:number; original:string }>) =>
            targets.map(target => ({ ...target, replacement:target.original.replaceAll("。", ""), rule:"FMT-local" })));
        const result = await repairReadWeaveFormatBatch(original, repair);
        expect(repair).toHaveBeenCalledTimes(1);
        expect(repair.mock.calls[0][0]).toHaveLength(3);
        expect(result.body).toBe("第一句\n\n第二句\n\n第三句");
        expect(result.warnings).toEqual([]);
    });
    it("groups a long review across every finding without a first-N cutoff", () => {
        const targets = Array.from({ length: 11 }, (_, index) =>
            ({ original: `${String(index)  }：${  "x".repeat(400)}`, index }));
        const groups = groupReadWeaveFormatTargets(targets);
        expect(groups.length).toBeGreaterThan(1);
        expect(groups.flat().map(target => target.index)).toEqual(targets.map(target => target.index));
        expect(groups.every(group => group.length === 1
            || group.reduce((total, target) => total + target.original.length, 0) <= 1_000)).toBe(true);
    });
    it("accepts case-only label corrections but rejects lexical or protected changes", () => {
        const body = "代码仓库（repository）\n\n`repository`";
        expect(applyReadWeaveFormatPatches(body, [ { start:0, original:"代码仓库（repository）",
            replacement:"代码仓库（Repository）", rule:"FMT-local" } ]))
            .toBe("代码仓库（Repository）\n\n`repository`");
        expect(() => applyReadWeaveFormatPatches(body, [ { start:0, original:"代码仓库（repository）",
            replacement:"代码仓库（Repositories）", rule:"FMT-local" } ])).toThrow();
    });
    it("allows moving an explicitly supplied acronym outside an official name without changing that name", () => {
        const original = "他是加州大学洛杉矶分校（University of California, Los Angeles, UCLA）教授";
        const replacement = "他是 UCLA 加州大学洛杉矶分校（University of California, Los Angeles）教授";
        expect(applyReadWeaveFormatPatches(original, [ { start:0, original,
            replacement, rule:"FMT-local" } ])).toBe(replacement);
        expect(readWeaveFormatIssues(replacement)).not.toContain(
            "FMT-121：英文名称括号不能混入缩写、别名或分隔说明，须核对已有名称而非编造展开");
        expect(() => applyReadWeaveFormatPatches(original, [ { start:0, original,
            replacement:replacement.replace("Los Angeles", "San Diego"), rule:"FMT-local" } ])).toThrow();
    });
    it("does not assign the first acronym meaning to an explicitly different expansion", async () => {
        const identity = { abbreviation:"IP",chineseName:"知识产权",englishName:"Intellectual Property" };
        const contrast = "这与网络协议中的 IP（Internet Protocol）无关";
        const repaired = await repairReadWeaveConventionalTerms(`IP 用于电路复用\n\n${contrast}`,"IP 是什么？",async()=>[{
            token:"IP",...identity,confidence:"high",basis:"established-usage",contextReason:"芯片语境"
        }]);
        expect(repaired.body).toContain(contrast);
        expect(repaired.body).not.toContain("知识产权（Internet Protocol）");
        const direct = `IP 知识产权（Intellectual Property）\n\n${contrast}`;
        expect(formatReadWeaveTermReferences(direct,identity)).toBe(direct);
    });
    it.each([ "是 Intellectual Property 的缩写", "的英文全称是 Intellectual Property", "中的字母 I 表示 Intellectual" ])(
        "preserves the abbreviation as the subject of a spelling statement: %s", async statement => {
            const identity = { abbreviation:"IP",chineseName:"知识产权",englishName:"Intellectual Property" };
            const label = "IP 知识产权（Intellectual Property）";
            const body = `## IP 是什么\n\nIP ${statement}\n\nIP 用于电路复用\n\n> IP ${statement}`;
            const repaired = await repairReadWeaveConventionalTerms(body,"IP 全称是什么？",async targets=>targets.map(target=>({
                occurrenceId:target.occurrenceId,token:"IP",...identity,confidence:"high",basis:"established-usage",contextReason:"原文提供该名称"
            })));
            expect(repaired.body).toContain(`${label}${statement}`);
            expect(repaired.body).toContain("知识产权用于电路复用");
            expect(repaired.body).toContain(`> IP ${statement}`);
            const direct = `## ${label}\n\nIP ${statement}\n\nIP 用于电路复用`;
            const referenced = formatReadWeaveTermReferences(direct,identity);
            expect(referenced).toBe(direct);
            expect(formatReadWeaveTermReferences(referenced,identity)).toBe(referenced);
        }
    );
    it("does not mistake a contextual full-name sentence for a compliant term label", async () => {
        const body = "IP 在芯片设计语境中的全称是知识产权（Intellectual Property），指可复用模块";
        const resolver = vi.fn(async () => [{ token:"IP",chineseName:"知识产权",englishName:"Intellectual Property",
            confidence:"high",basis:"established-usage",contextReason:"原文章明确配对该名称" }]);
        const result = await repairReadWeaveConventionalTerms(body,"这里的 IP 全称是什么？",resolver,
            undefined,"IP，即知识产权（Intellectual Property）");
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(result.body).toContain("IP 知识产权（Intellectual Property）");
        expect(result.body).toContain("在芯片设计语境中的全称是知识产权（Intellectual Property）");
    });
    it("pins the current public skill and includes conditional formula and media guidance", () => {
        expect(READWEAVE_WRITING_SKILL_REVISION).toBe("bundled-complete-skill");
        const contract = HUMAN_READABLE_CHINESE_STYLE_CONTRACT.join("\n");
        expect(contract).toContain("FMT-121");
        expect(contract).toContain("无法确认时省略英文括号");
        expect(contract).toContain("用户询问公式或回答主动引入公式时按重要程度解释");
        expect(contract).toContain("附带公式只补理解所需信息");
        expect(contract).toContain("不把所有层级压平");
        expect(contract).toContain("FMT-111/120");
        expect(contract).toContain("格式残留不阻断安全正文交付");
        expect(contract).toContain("即使被单独阅读");
        expect(contract).toContain("先说明可计算关系和结果");
        expect(contract).toContain("仅凭当前材料无法确定哪个原始字段有误");
        expect(contract).toContain("只作待处理材料");
        expect(contract).toContain("图片文字");
    });
    it.each([ "缓存（Cache, Buffer）", "加速梯度（Accelerated Gradient，AG）",
        "输入输出（Input/Output; IO）" ])("reviews extra Latin-only name content: %s", source => {
        const target = readWeaveNameReviewTargets(source)[0];
        expect(target.diagnostics).toEqual([ "extra-english-name-parentheses" ]);
        expect(target.replacement).toBeUndefined();
        expect(formatReadWeaveNameParentheses(source)).toBe(source);
        expect(readWeaveFormatIssues(source).some(issue => issue.startsWith("FMT-121"))).toBe(true);
        for (const protectedSource of [ `\`${source}\``, `> ${source}`, `\`\`\`text\n${source}\n\`\`\`` ]) {
            expect(readWeaveNameReviewTargets(protectedSource)).toEqual([]);
            expect(readWeaveFormatIssues(protectedSource)).toEqual([]);
        }
    });
    it("moves a supplied non-acronym alias out of the English name in both fields", () => {
        const label = "布局消解（Layout Resolution，也称 布局解析）";
        const question = `${label}是什么？`;
        const definition = `- ${label}：用于分析布局；仅在 2 个条件下适用；不能改变顺序`;
        const expectedQuestion = "布局消解（Layout Resolution）（也称 布局解析）是什么？";
        const expectedDefinition = "- 布局消解（Layout Resolution）：也称布局解析；用于分析布局；仅在 2 个条件下适用；不能改变顺序";
        expect(readWeaveFormatIssues(question)).toContain(
            "FMT-045/051：中文别名或说明不能混入英文名称括号，名称含义须结合文章核对"
        );
        expect(formatReadWeaveNameParentheses(question)).toBe(expectedQuestion);
        expect(formatReadWeaveMarkdown(definition)).toBe(expectedDefinition);
        expect(formatReadWeaveMarkdown(expectedDefinition)).toBe(expectedDefinition);
        expect(formatReadWeaveNameParentheses(expectedQuestion)).toBe(expectedQuestion);
        expect(readWeaveFormatIssues(expectedDefinition)).toEqual([]);
        const target = readWeaveNameReviewTargets(question, "question")[0];
        expect(target).toMatchObject({ field: "question", englishName: "Layout Resolution",
            semanticStatus: "requires-article-context", diagnostics: [ "mixed-bilingual-name-parentheses" ] });
        expect(question.slice(target.start, target.end)).toBe(target.original);
        expect(question.slice(0, target.start) + target.replacement + question.slice(target.end)).toBe(expectedQuestion);
    });
    it.each([
        [ "解析布局（analytical placement，也称 analytic placement）", "解析布局（analytical placement）（也称 analytic placement）" ],
        [ "颜色归一化(Color Normalization, 又称色彩标准化)", "颜色归一化(Color Normalization)（又称色彩标准化）" ],
        [ "图形处理器（Graphics Processing Unit；简称图形核心）", "图形处理器（Graphics Processing Unit）（简称图形核心）" ],
        [ "缓存（Cache，也称暂存区、缓冲区）", "缓存（Cache）（也称暂存区、缓冲区）" ],
        [ "缓存（Cache，又称暂存区）:保存数据", "缓存（Cache）:又称暂存区；保存数据" ]
    ])("repairs supplied aliases with either parenthesis and separator style: %s", (source, expected) => {
        expect(formatReadWeaveNameParentheses(source)).toBe(expected);
        expect(formatReadWeaveNameParentheses(expected)).toBe(expected);
    });
    it("reports ambiguous mixed names without inventing alias relationships", () => {
        for (const source of [ "布局消解（Layout Resolution，布局解析）", "布局消解（Layout 布局 Resolution）",
            "布局消解（Layout Resolution，并非布局解析）", "布局消解（Layout Resolution，也称布局解析但不等同布局分析）" ]) {
            const target = readWeaveNameReviewTargets(source)[0];
            expect(target.diagnostics).toEqual([ "mixed-bilingual-name-parentheses" ]);
            // Only explicit name lists, not arbitrary explanatory clauses, are movable.
            expect(target.replacement).toBeUndefined();
            expect(formatReadWeaveNameParentheses(source)).toBe(source);
        }
    });
    it("exposes syntactically valid non-acronym names for article review without catalog replacement", () => {
        const source = "- 布局消解（Layout Resolution）：处理布局";
        const target = readWeaveNameReviewTargets(source, "definition")[0];
        expect(target).toMatchObject({ field: "definition", englishName: "Layout Resolution",
            semanticStatus: "requires-article-context", diagnostics: [] });
        expect(target.replacement).toBeUndefined();
        expect(formatReadWeaveMarkdown(source)).toBe(source);
        expect(readWeaveFormatIssues(source)).toEqual([]);
    });
    it("keeps distinct offsets for repeated names after protected copies", () => {
        const label = "布局消解（Layout Resolution，也称布局解析）";
        const source = `\`${label}\`\n\n${label}是什么？\n\n- ${label}：用于布局`;
        const targets = readWeaveNameReviewTargets(source);
        expect(targets).toHaveLength(2);
        expect(targets[0].start).toBeGreaterThan(label.length);
        expect(targets[1].start).toBeGreaterThan(targets[0].end);
        for (const target of targets) expect(source.slice(target.start, target.end)).toBe(target.original);
        const formatted = formatReadWeaveMarkdown(source);
        expect(formatted).toContain(`\`${label}\``);
        expect(readWeaveNameReviewTargets(formatted).every(target => !target.diagnostics.length)).toBe(true);
    });
    it("repairs definitions beside nested code while preserving the code and quote bytes", () => {
        const label = "布局消解（Layout Resolution，也称布局解析）";
        const code = `  ~~~ts\n  const label = "${label}";\n  ~~~`;
        const quote = `  > ${label}。`;
        const source = `- ${label}：定义\n\n${code}\n\n${quote}\n\n- ${label}：另一个定义`;
        const targets = readWeaveNameReviewTargets(source);
        expect(targets).toHaveLength(2);
        const formatted = formatReadWeaveMarkdown(source);
        expect(formatted).toContain(code);
        expect(formatted).toContain(quote);
        expect(formatted).toContain("- 布局消解（Layout Resolution）：也称布局解析；定义");
        expect(formatted).toContain("- 布局消解（Layout Resolution）：也称布局解析；另一个定义");
        expect(formatReadWeaveMarkdown(formatted)).toBe(formatted);
    });
    const hybrid = "布局消解（Layout Resolution，也称 布局解析）";
    it.each([
        `\`${hybrid}\``, `\`\`const label = \`${hybrid}\`;\`\``,
        `\`\`\`ts\nconst label = "${hybrid}";\n\`\`\``,
        `- 示例\n\n  \`\`\`ts\n  const label = "${hybrid}";\n  \`\`\``,
        `- 示例\n\n  ~~~ts\n  const label = "${hybrid}";\n  ~~~`,
        `- 示例\n\n  > ${hybrid}。`,
        `$\\text{${hybrid}}$`, `$$\n\\text{${hybrid}}\n\n+ x\n$$`,
        `\\(\\text{${hybrid}}\\)`, `\\[\\text{${hybrid}}\\]`,
        `“${hybrid}”`, `"${hybrid}"`, `'${hybrid}'`, `「${hybrid}」`,
        `“第一段\n\n${hybrid}”`, `> ${hybrid}。`,
        `[${hybrid}](https://example.org/name)`, `https://example.org/${hybrid}`,
        `| 名称 |\n| --- |\n| ${hybrid} |`
    ])("protects opaque hybrid names from detection and repair: %s", source => {
        expect(readWeaveNameReviewTargets(source)).toEqual([]);
        expect(formatReadWeaveNameParentheses(source)).toBe(source);
        expect(formatReadWeaveMarkdown(source)).toBe(source);
        expect(readWeaveFormatIssues(source)).toEqual([]);
    });
    it("passes the actual question and optional article context separately from answer text", async () => {
        const question = "这里的 IP 是什么？";
        const articleContext = "本段讨论片上集成的可复用知识产权模块";
        const resolver = vi.fn(async (_targets, context) => {
            expect(context).toEqual({ question, articleContext });
            return [ { token: "IP", chineseName: "知识产权", englishName: "Intellectual Property",
                confidence: "high", basis: "established-usage", contextReason: "文章讨论芯片模块" } ];
        });
        const result = await repairReadWeaveConventionalTerms("IP 用于网络传输", question, resolver,
            undefined, articleContext);
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(result.body).toContain("IP 知识产权（Intellectual Property）");
        const legacy = vi.fn(async () => []);
        await repairReadWeaveConventionalTerms("IP 用于网络传输", question, legacy);
        expect(legacy.mock.calls[0]).toEqual([
            [ { occurrenceId: "term-0", token: "IP", before: "", after: " 用于网络传输" } ], { question }
        ]);
    });
    it("grounds meanings in the article while limiting explicit article framing", () => {
        const contract = HUMAN_READABLE_CHINESE_STYLE_CONTRACT.join("\n");
        expect(contract).toContain("名称、缩写展开、词义、定义和解释始终以当前文章的实际用法为依据");
        expect(contract).toContain("不超过回答正文的 10%");
        expect(contract).toContain("除非用户明确要求");
        expect(contract).toContain("问题与定义中的名称都须核对");
    });
    it("keeps a continuous bilingual definition while checking ordinary parallel lists", () => {
        const definition = "- 缓存（Cache）：暂存可复用数据；用于页面、文件、查询等场景；容量有限";
        expect(readWeaveFormatIssues(definition)).not.toContain(
            "FMT-036：冒号后的两个以上独立并列项需要分行"
        );
        expect(readWeaveFormatIssues("可选介质：内存、磁盘、远端存储")).toContain(
            "FMT-036：冒号后的两个以上独立并列项需要分行"
        );
    });
    it("puts a verified Chinese person name before its English or pinyin name", () => {
        expect(formatReadWeavePersonNameOrder(
            "Haoxing Ren（任浩星）是芯片设计研究者",
            "Haoxing Ren"
        )).toBe("任浩星（Haoxing Ren）是芯片设计研究者");
        expect(formatReadWeavePersonNameOrder(
            "任浩星（Haoxing Ren）是芯片设计研究者",
            "Haoxing Ren"
        )).toBe("任浩星（Haoxing Ren）是芯片设计研究者");
        expect(formatReadWeavePersonNameOrder(
            "Haoxing Ren（任浩星）是芯片设计研究者",
            "任浩星（Haoxing Ren）"
        )).toBe("任浩星（Haoxing Ren）是芯片设计研究者");
        expect(formatReadWeavePersonNameOrder(
            "`Haoxing Ren（任浩星）` 是原样代码",
            "Haoxing Ren"
        )).toBe("`Haoxing Ren（任浩星）` 是原样代码");
        expect(readWeaveFormatIssues("Haoxing Ren（任浩星）是芯片设计研究者"))
            .toContain("FMT-044：人物姓名顺序必须为中文姓名（English or Pinyin Name）");
        expect(readWeaveFormatIssues("任浩星（Haoxing Ren）是芯片设计研究者"))
            .not.toContain("FMT-044：人物姓名顺序必须为中文姓名（English or Pinyin Name）");
    });
    it("closes the exact live acronym-order failures without changing compliant text", () => {
        const fullName = "- IP 全称是知识产权（Intellectual Property）：在芯片设计中指可复用模块";
        const canonical = "- IP 知识产权（Intellectual Property）：在芯片设计中指可复用模块";
        expect(formatReadWeaveCanonicalEntities(fullName)).toBe(canonical);
        for (const declaration of [ "即", "是", "指的是", "的全称为" ]) {
            expect(formatReadWeaveCanonicalEntities(fullName.replace("全称是", declaration))).toBe(canonical);
        }
        expect(formatReadWeaveCanonicalEntities(canonical)).toBe(canonical);
        expect(formatReadWeaveCanonicalEntities(`> ${fullName}`)).toBe(`> ${fullName}`);
        expect(formatReadWeaveCanonicalEntities("合法化（legalization，LG）：消除重叠"))
            .toBe("LG 合法化（legalization）：消除重叠");
        expect(formatReadWeaveCanonicalEntities("加权平均线长（weighted-average wirelength，WA）用于求梯度"))
            .toBe("WA 加权平均线长（weighted-average wirelength）用于求梯度");
        expect(formatReadWeaveCanonicalEntities(
            "Nesterov 加速梯度（Nesterov Accelerated Gradient，NAG）用于优化"
        )).toBe("NAG Nesterov 加速梯度（Nesterov Accelerated Gradient）用于优化");
        expect(readWeaveFormatIssues(
            "Nesterov 加速梯度（Nesterov Accelerated Gradient，NAG）用于优化"
        )).toContain("FMT-052：缩写必须置于中文全称和英文全称之前");
        expect(formatReadWeaveCanonicalEntities(
            "它属于电子设计自动化（Electronic Design Automation，EDA）领域"
        )).toBe("它属于 EDA 电子设计自动化（Electronic Design Automation）领域");
        expect(formatReadWeaveCanonicalEntities(
            "与超大规模集成电路（Very Large Scale Integration，VLSI）物理设计相关"
        )).toBe("与 VLSI 超大规模集成电路（Very Large Scale Integration）物理设计相关");
        const compliant = "GPU 图形处理器（Graphics Processing Unit）用于并行计算";
        expect(formatReadWeaveCanonicalEntities(compliant)).toBe(compliant);
        expect(readWeaveFormatIssues(compliant)).not.toContain(
            "FMT-052：缩写必须置于中文全称和英文全称之前"
        );
    });

    it("formats dimensional labels without assigning ML a meaning", () => {
        expect(formatReadWeaveCanonicalEntities("3D 芯片采用3D堆叠ML加速器"))
            .toBe("三维芯片采用三维堆叠ML加速器");
        expect(formatReadWeaveCanonicalEntities("最大似然估计采用 ML 模型"))
            .toBe("最大似然估计采用 ML 模型");
        expect(formatReadWeaveCanonicalEntities("这里的 3D 表示沿垂直方向集成"))
            .toBe("这里的三维表示沿垂直方向集成");
        expect(formatReadWeaveCanonicalEntities("DPO-3D 与 3D-MAPS 是方法原名"))
            .toBe("DPO-3D 与 3D-MAPS 是方法原名");
    });
    it("does not resolve a slash-separated language name and introduced initialism as one abbreviation", async () => {
        const resolve = vi.fn();
        const body = "CUDA 统一计算设备架构（Compute Unified Device Architecture）用于计算；用 C++/CUDA 编写";
        const result = await repairReadWeaveConventionalTerms(body, "内核是什么？", resolve);
        expect(resolve).not.toHaveBeenCalled();
        expect(result.body).toBe(body);
    });
    it("annotates a slash-bearing initialism without treating its slash as part of the initials", async () => {
        const result = await repairReadWeaveConventionalTerms("提供 I/O 功能", "内核是什么？", async () => [{
            token:"I/O", chineseName:"输入输出", englishName:"Input/Output", confidence:"high",
            basis:"established-usage", contextReason:"操作系统处理数据输入和输出"
        }]);
        expect(result.body).toBe("提供 I/O 输入输出（Input/Output）功能");
        expect(result.warnings).toEqual([]);
    });
    it("removes surname commentary while putting a person's Chinese name first", () => {
        expect(formatReadWeavePersonNameOrder(
            "David Z. Pan（潘大卫，Pan 为姓）是研究者",
            "David Z. Pan"
        )).toBe("潘大卫（David Z. Pan）是研究者");
    });
    it("preserves semantic heading depth without inventing a panel-level answer heading", () => {
        expect(formatReadWeaveAnswerHeadings(
            "直接回答\n\n# 原理\n\n正文\n\n## 边界\n\n说明"
        )).toBe("直接回答\n\n# 原理\n\n正文\n\n## 边界\n\n说明");
        expect(formatReadWeaveAnswerHeadings("只有一个连续语义块")).toBe("只有一个连续语义块");
    });
    it("removes only a leading heading that duplicates the visible question", () => {
        const body = "# DAX 是什么\n\nDAX 直接访问（Direct Access）是内核机制\n\n## 如何运作\n\n它绕过页面缓存";
        expect(formatReadWeaveAnswerHeadings(body, true, "DAX 是什么？"))
            .toBe("DAX 直接访问（Direct Access）是内核机制\n\n## 如何运作\n\n它绕过页面缓存");
        expect(formatReadWeaveAnswerHeadings(body, true, "DAX 有什么用途？")).toBe(body);
    });
    it("keeps formula section hierarchy, source headings and repeated formatting stable", () => {
        const body = "## 公式用途\n\n解释\n\n### 符号\n\n解释\n\n### 示例\n\n"
            + "```python\n# original comment\nvalue = 1\n```\n\n> # 原样标题\n\n## 边界\n\n说明";
        expect(formatReadWeaveAnswerHeadings(body)).toBe(body);
        expect(formatReadWeaveAnswerHeadings(formatReadWeaveAnswerHeadings(body))).toBe(body);
        expect(readWeaveFormatIssues(body)).toContain("FMT-032：所有生成标题须使用以点号结尾的连续层级编号");
        const codeOnly = "```markdown\n# 原样标题\n#### 原样层级\n```";
        expect(formatReadWeaveAnswerHeadings(codeOnly)).toBe(codeOnly);
        expect(readWeaveFormatIssues(codeOnly)).toEqual([]);
        expect(readWeaveFormatIssues("## 父级\n\n说明\n\n#### 子级\n\n说明"))
            .toContain("FMT-031：子标题不能跳过必要的父级层级");
    });
    it("annotates one incidental initialism without accepting replacement prose", async () => {
        const body = "这段涉及 ABC 与其他对象，保留 12 个条件";
        const resolve = vi.fn(async()=>[ {
            token:"ABC",chineseName:"示例连接",englishName:"Alpha Beta Connection",
            confidence:"high",basis:"established-usage",contextReason:"当前上下文指这种通行连接",
            replacement:"禁止替换整篇" } ]);
        const result = await repairReadWeaveConventionalTerms(body,"名称来历是什么？",resolve);
        expect(result.body).toBe(body.replace("ABC ","ABC 示例连接（Alpha Beta Connection）"));
        expect(result.knowledgeTerms).toEqual([ "ABC" ]);
        expect(resolve).toHaveBeenCalledTimes(1);
    });
    it.each([
        { confidence:"low" },{ basis:"source-quote" },
        { englishName:"Invented Different Expansion" },
        { chineseName:"示例：增加事实" },{ contextReason:"" }
    ])("rejects unsupported annotation payloads %o", async bad => {
        const body = "使用 ABC 与其他对象";
        const result = await repairReadWeaveConventionalTerms(body,"名称来历？",async()=>[ {
            token:"ABC",chineseName:"示例连接",englishName:"Alpha Beta Connection",confidence:"high",
            basis:"established-usage",contextReason:"当前上下文指这种通行连接",...bad
        } ]);
        expect(result.body).toBe(body);
        expect(result.knowledgeTerms).toEqual([]);
    });
    it.each([ "`ABC`","《ABC Book》","ABC 示例连接（Alpha Beta Connection）",
        "示例机构（Lumen ABC）", "示例机构 (Lumen ABC)",
        `示例机构（${"Label ".repeat(40)}ABC）` ])(
        "does not annotate protected or ambiguous occurrences: %s", async body => {
            const resolve = vi.fn();
            expect((await repairReadWeaveConventionalTerms(body,"来源？",resolve)).body).toBe(body);
            expect(resolve).not.toHaveBeenCalled();
        }
    );
    it("preserves an existing label while annotating a separate prose initialism", async () => {
        const body = "示例机构（Lumen DEF）将 ABC 与其他对象连接";
        const resolve = vi.fn(async (targets: Array<{ token:string }>) => {
            expect(targets.map(target=>target.token)).toEqual([ "ABC" ]);
            return [ { token:"ABC",chineseName:"示例连接",englishName:"Alpha Beta Connection",
                confidence:"high",basis:"established-usage",contextReason:"当前上下文指通行连接" } ];
        });
        const result = await repairReadWeaveConventionalTerms(body,"名称来历？",resolve);
        expect(result.body).toBe("示例机构（Lumen DEF）将 ABC 示例连接（Alpha Beta Connection）与其他对象连接");
        expect(resolve).toHaveBeenCalledTimes(1);
    });
    it("repairs the question's own acronym when the answer still leaves it bare", async () => {
        const resolve = vi.fn(async () => [ {
            token:"ABC",chineseName:"示例连接",englishName:"Alpha Beta Connection",
            confidence:"high",basis:"established-usage",contextReason:"当前问题指通行连接"
        } ]);
        const result = await repairReadWeaveConventionalTerms(
            "ABC 是对象","ABC 的名称来历？",resolve);
        expect(result.body).toBe("ABC 示例连接（Alpha Beta Connection）是对象");
        expect(resolve).toHaveBeenCalledTimes(1);
    });
    it("repairs every abbreviation in one batched request and simplifies later uses", async () => {
        const tokens = [ "ABC", "DEF", "GHI", "JKL", "MNO", "PQR", "STU", "VWX", "YZA", "BCD" ];
        const body = `${tokens.join("、")}；再次使用 ABC`;
        const resolve = vi.fn(async (targets: Array<{ occurrenceId:string; token:string }>) => targets.map(target => ({
            occurrenceId:target.occurrenceId,
            token:target.token,
            chineseName:"示例术语",
            englishName:target.token.split("").map(letter=>`${letter}word`).join(" "),
            confidence:"high",basis:"established-usage",contextReason:"上下文明确"
        })));
        const result = await repairReadWeaveConventionalTerms(body,"这些缩写是什么意思？",resolve);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0][0]).toHaveLength(11);
        expect(result.body).toContain("ABC 示例术语（Aword Bword Cword）");
        expect(result.body.endsWith("再次使用示例术语")).toBe(true);
    });
    it("normalizes a reversed Chinese acronym label without nested parentheses", async () => {
        const result = await repairReadWeaveConventionalTerms("知识产权（IP）用于保护创作成果","IP 是什么？",async()=>[ {
            token:"IP",chineseName:"知识产权",englishName:"Intellectual Property",
            confidence:"high",basis:"established-usage",contextReason:"创作成果语境"
        } ]);
        expect(result.body).toBe("IP 知识产权（Intellectual Property）用于保护创作成果");
    });
    it("keeps bare references for occurrence resolution instead of inheriting the first label", () => {
        expect(formatReadWeaveTermReferences(
            "- NPU 神经网络处理单元（Neural Processing Unit）：NPU 负责运算；NPU 不是存储器",
            { abbreviation:"NPU",chineseName:"神经网络处理单元",englishName:"Neural Processing Unit" }
        )).toBe("- NPU 神经网络处理单元（Neural Processing Unit）：NPU 负责运算；NPU 不是存储器");
    });
    it("accepts concise context and trimmed names without mutating payload", async () => {
        const term = Object.freeze({ token:"ABC",chineseName:" 示例连接 ",
            englishName:" Alpha Beta Connection ",confidence:"high",basis:"established-usage",
            contextReason:"指连接" });
        const result = await repairReadWeaveConventionalTerms("使用 ABC 与其他对象","来历？",
            async()=>[ term ]);
        expect(result.body).toBe("使用 ABC 示例连接（Alpha Beta Connection）与其他对象");
        expect(result.warnings).toEqual([]);
        expect(term.chineseName).toBe(" 示例连接 ");
    });
    it.each([ undefined, [], [ { token:"ABC" } ] ])(
        "records rejected response shape without changing text: %j", async payload => {
            const result = await repairReadWeaveConventionalTerms("使用 ABC 与其他对象","来历？",
                async()=>payload);
            expect(result.body).toBe("使用 ABC 与其他对象");
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.knowledgeTerms).toEqual([]);
        }
    );
    it("removes only the newly exposed space between Chinese text", async () => {
        const result = await repairReadWeaveOptionalQualifiers("名称来自 ABC 喜剧","从何得名？",
            async()=>[ { token:"ABC",omit:true,reason:"多余的来源机构简称" } ]);
        expect(result.body).toBe("名称来自喜剧");
    });
    it("only omits an approved unrequested qualifier, never rewrites prose", async () => {
        const body = "Lumen 得名于 ABC 喜剧《Light Story》，其余 12 个字不改";
        const approve = vi.fn(async () => [ { token:"ABC",omit:true,reason:"只是额外的来源机构标签",
            replacement:"模型企图返回新正文" } ]);
        const result = await repairReadWeaveOptionalQualifiers(body, "Lumen 从何得名？", approve);
        expect(result.body).toBe(body.replace(" ABC ", ""));
        expect(approve).toHaveBeenCalledTimes(1);
        expect(result.rounds).toBe(1);
        expect(result.body).toContain("12");
    });
    it("reviews every independent qualifier in one request instead of dropping later matches", async () => {
        const body = "资料来自 ABC 公司、DEF 部门和 GHI 团体";
        const approve = vi.fn(async (targets: Array<{ token: string }>) => {
            expect(targets.map(target => target.token)).toEqual([ "ABC", "DEF", "GHI" ]);
            return targets.map(target => ({ token: target.token, omit: false, reason: "保留来源身份" }));
        });
        expect((await repairReadWeaveOptionalQualifiers(body, "资料从何而来？", approve)).body).toBe(body);
        expect(approve).toHaveBeenCalledTimes(1);
    });
    it.each([
        "ABC 和另一对象", "ABC 是核心对象", "“ABC 来源机构”", "《ABC 喜剧》",
        "`ABC 来源机构`", "ABC 示例机构（Example Institution）", "ABC 标签及 ABC 标签"
    ])("never submits protected or ambiguous qualifiers: %s", async body => {
        const approve = vi.fn();
        expect((await repairReadWeaveOptionalQualifiers(body, "来源？", approve)).body).toBe(body);
        expect(approve).not.toHaveBeenCalled();
    });
    it("preserves requested qualifiers and rejected proposals", async () => {
        const body = "ABC 来源机构";
        const approve = vi.fn(async () => [ { token:"ABC",omit:false,reason:"不能删除主体" } ]);
        expect((await repairReadWeaveOptionalQualifiers(body, "ABC 是谁？", approve)).rounds).toBe(0);
        expect(approve).not.toHaveBeenCalled();
        expect((await repairReadWeaveOptionalQualifiers(body, "来源？", approve)).body).toBe(body);
    });
    it.each([ "（ABC）", "(ABC)" ])("only omits an approved bracketed alias %s", async fragment => {
        const body = `Lumen 得名于示例广播公司${fragment}喜剧《Light Story》，12 个字不改`;
        const approve = vi.fn(async (targets: Array<{ token:string;fragment:string }>) => {
            expect(targets[0]).toMatchObject({ token:"ABC",fragment });
            return [ { token:"ABC",omit:true,reason:"中文机构名已保留，别名不影响来历" } ];
        });
        const result = await repairReadWeaveOptionalQualifiers(body, "Lumen 从何得名？", approve);
        expect(result.body).toBe(body.replace(fragment, ""));
        expect(approve).toHaveBeenCalledTimes(1);
        expect(result.rounds).toBe(1);
    });
    it.each([ "《示例公司（ABC）》", "`示例公司（ABC）`", "示例公司（ABC）与示例公司（ABC）" ])(
        "does not submit protected or repeated parenthetical names: %s", async body => {
            const approve = vi.fn();
            const result = await repairReadWeaveOptionalQualifiers(body, "从何得名？", approve);
            expect(result.body).toBe(body);
            expect(approve).not.toHaveBeenCalled();
        }
    );
    it("renders a sourced English full-name answer with its separate Chinese identity", () => {
        const input = "XPT 的官方英文全称是 Example Packet Transfer";
        const expected = "XPT 示例分组传输（Example Packet Transfer）";
        expect(formatReadWeaveFullNameOpening(input, "示例分组传输")).toBe(expected);
        expect(formatReadWeaveFullNameOpening(expected, "示例分组传输")).toBe(expected);
        expect(formatReadWeaveFullNameOpening(input)).toBe(input);
        const paragraph = `${input}，还有另外的解释`;
        expect(formatReadWeaveFullNameOpening(paragraph, "示例分组传输")).toBe(paragraph);
    });
    it("normalizes a supplied bilingual name without inventing either name", () => {
        expect(formatReadWeaveMarkdown("XPT 的官方英文全称是 Example Packet Transfer（示例分组传输）。"))
            .toBe("XPT 示例分组传输（Example Packet Transfer）");
    });
    it("separates three explicit word meanings but leaves connected mechanisms alone", () => {
        const input = "Example 指示例；Packet 指分组；Transfer 指传输；这是一段后续说明";
        const formatted = formatReadWeaveMarkdown(input);
        expect(formatted).toBe("- 示例（Example）\n- 分组（Packet）\n- 传输（Transfer）\n\n这是一段后续说明");
        expect(formatReadWeaveMarkdown(formatted)).toBe(formatted);
        expect(formatReadWeaveMarkdown("先读入记录；计算结果；保存摘要")).toBe("先读入记录；计算结果；保存摘要");
    });
    it("groups separate bilingual meaning paragraphs without rewriting their content", () => {
        const input = "Example（示例）：表示一个实例\n\nPacket（分组）：表示一组记录\n\nTransfer（传输）：表示传递过程\n\n后续说明不改变";
        const expected = "- 示例（Example）：表示一个实例\n\n- 分组（Packet）：表示一组记录"
            + "\n\n- 传输（Transfer）：表示传递过程\n\n后续说明不改变";
        expect(formatReadWeaveMarkdown(input)).toBe(expected);
        expect(formatReadWeaveMarkdown(expected)).toBe(expected);
    });
    it("formats isolated definitions without moving a heading or protected block", () => {
        const body = "示例（Example）：一个实例\n\n## 中间标题\n\n分组（Packet）：一组记录"
            + "\n\n> Transfer（传输）：逐字引文。\n\n传输（Transfer）：传递过程";
        expect(formatReadWeaveMarkdown(body)).toBe(
            "- 示例（Example）：一个实例\n\n## 中间标题\n\n- 分组（Packet）：一组记录"
            + "\n\n> Transfer（传输）：逐字引文。\n\n- 传输（Transfer）：传递过程"
        );
        expect(formatReadWeaveMarkdown("Example（示例）：一个实例")).toBe("- 示例（Example）：一个实例");
    });
    const protectedCases = [
        "https://example.org/a?x=1&y=2",
        "`const x = {a: 1};`",
        "```js\nconst x = {a: 1};\n```",
        "$x_{i} \\leq 0$",
        "$$E = mc^2$$",
        "[文档](https://example.org/a?b=1)",
        "> 逐字引文：不能改。",
        "| 项目 | 值 |\n| --- | --- |\n| 标点 | 原样。 |",
        "“原文中的中文句号。”",
        "C:\\data\\test.json"
    ];
    it.each(protectedCases)("keeps opaque data unchanged: %s", (value) => {
        const result = formatReadWeaveMarkdown(value);
        expect(result).toBe(value);
        expect(formatReadWeaveMarkdown(result)).toBe(result);
    });
    it("keeps five paragraphs, quantities, conditions and negation", () => {
        const body =
            "条件：温度低于 20 K\n\n不会提高效率\n\n成本为 3.25 元\n\n仅适用于固体\n\n第五段";
        expect(formatReadWeaveMarkdown(body)).toBe(body);
    });
    it("formats a flat parallel list without changing the items", () => {
        expect(formatReadWeaveMarkdown("材料：铜、铝、银")).toBe("材料：\n  - 铜\n  - 铝\n  - 银");
    });
    it("keeps a single definition in one continuous list item under the latest contract", () => {
        expect(formatReadWeaveMarkdown("熵（Entropy）：表示状态的不确定程度")).toBe(
            "- 熵（Entropy）：表示状态的不确定程度"
        );
    });
    it("separates two explicitly enumerated objects and reports current rule identifiers", () => {
        expect(formatReadWeaveMarkdown("材料：铜、铝")).toBe("材料：\n  - 铜\n  - 铝");
        expect(readWeaveFormatIssues("材料：铜、铝")).toContain("FMT-036：冒号后的两个以上独立并列项需要分行");
        expect(readWeaveFormatIssues("保留2份")).toContain("FMT-047：中文与英文或数字之间缺少空格");
        const meaning = "Input 指输入；Output 指输出";
        expect(formatReadWeaveMarkdown(meaning)).toBe("- 输入（Input）\n- 输出（Output）");
    });
    it("keeps a definition continuous and does not invent steps from a causal sentence", () => {
        const definition = "RAM 随机存取存储器（Random Access Memory）：临时存放数据；读写速度快；用于程序运行；不能代替长期存储";
        expect(formatReadWeaveMarkdown(definition)).toBe(`- ${definition}`);
        expect(formatReadWeaveMarkdown(`- ${definition}`)).toBe(`- ${definition}`);
        const cause = "盒盖关紧后，水汽较难进入，物品更不容易受潮";
        expect(formatReadWeaveMarkdown(cause)).toBe(cause);
    });
    it("merges only plain definition paragraphs and preserves all words", () => {
        const body = "- 幂等性（Idempotence）：重复执行结果不变\n\n可用于重复投递\n\n不代表没有副作用";
        expect(formatReadWeaveDefinitionBlock(body)).toBe(body.replace(/\n\n/gu, "；"));
        for (const extra of [ "\n\n## 例子", "\n\n> 原样引文。", "\n\n$x = 2$" ]) {
            expect(formatReadWeaveDefinitionBlock(body + extra)).toBe(body + extra);
        }
    });
    it("uses headings for standalone labels, not labels with inline values", () => {
        expect(formatReadWeaveMarkdown("原代码：\n\n```python\nx = 1\n```"))
            .toBe("## 原代码\n\n```python\nx = 1\n```");
        expect(formatReadWeaveMarkdown("颜色：红色")).toBe("颜色：红色");
    });
    it("aligns a proven comment copy while keeping the original statements unchanged", () => {
        const original = "values = [2, 4, 6]\ntotal = sum(values)\nprint(total)";
        const copy = "values = [2, 4, 6]  # 数值\ntotal = sum(values)  # 求和\nprint(total)  # 输出";
        const input = `原代码：\n\n\`\`\`python\n${original}\n\`\`\`\n\n`
            + `注释副本：\n\n\`\`\`python\n${copy}\n\`\`\``;
        const result = formatReadWeaveMarkdown(input);
        expect(result).toContain(original);
        expect(result).toContain("values = [2, 4, 6]   # 数值\ntotal = sum(values)  # 求和"
            + "\nprint(total)         # 输出");
        expect(formatReadWeaveMarkdown(result)).toBe(result);
        expect(formatReadWeaveMarkdown(`\`\`\`python\n${copy}\n\`\`\``))
            .toBe(`\`\`\`python\n${copy}\n\`\`\``);
        const restored = formatReadWeaveCodeCopies(`\`\`\`python\n${copy}\n\`\`\``,
            [ `\`\`\`python\n${original}\n\`\`\`` ]);
        expect(restored.startsWith(`\`\`\`python\n${original}\n\`\`\``)).toBe(true);
        expect(formatReadWeaveCodeCopies(restored, [ `\`\`\`python\n${original}\n\`\`\`` ]))
            .toBe(restored);
        const changed = copy.replace("sum(values)", "len(values)");
        expect(formatReadWeaveCodeCopies(`\`\`\`python\n${changed}\n\`\`\``,
            [ `\`\`\`python\n${original}\n\`\`\`` ])).toBe(`\`\`\`python\n${changed}\n\`\`\``);
    });
    it.each([
        "> 材料：铜、铝。",
        "```text\n材料：铜、铝。\n```",
        "| 字段 | 原文 |\n| --- | --- |\n| 名称 | Example（示例）：原样。 |",
        "$$x_1 + x_2 = 12$$",
        "![原图](https://example.org/diagram.svg)",
        "```mermaid\nflowchart LR\nA --> B\n```"
    ])("preserves raw objects when applying the new presentation rules: %s", source => {
        expect(formatReadWeaveMarkdown(source)).toBe(source);
        expect(readWeaveFormatIssues(source)).toEqual([]);
    });
    it.each([ "不会增加", "增加至 20", "减少" ])("rejects factual drift %s", (replacement) => {
        expect(() =>
            applyReadWeaveFormatPatches("增加至 10", [
                { start: 0, original: "增加至 10", replacement, rule: "test" }
            ])
        ).toThrow();
    });
    it("rejects stale and overlapping patches atomically", () => {
        expect(() =>
            applyReadWeaveFormatPatches("甲乙", [
                { start: 1, original: "甲", replacement: "甲", rule: "test" }
            ])
        ).toThrow();
        expect(() =>
            applyReadWeaveFormatPatches(
                "甲乙",
                [ 0, 0 ].map((start) => ({
                    start,
                    original: "甲",
                    replacement: "甲 ",
                    rule: "test"
                }))
            )
        ).toThrow();
    });
    it("sends only failing lines and closes every bounded local repair", async () => {
        const repair = vi.fn(async (text: string) => text.replace(/。/gu, ""));
        const body = "第一行。\n\n第二行。\n\n第三行。";
        const result = await repairReadWeaveFormat(body, repair);
        expect(repair).toHaveBeenCalledTimes(3);
        expect(repair.mock.calls.every(([ text ]) => text !== body)).toBe(true);
        expect(result.body).toBe("第一行\n\n第二行\n\n第三行");
    });
    it("never calls a repair on compliant text", async () => {
        const repair = vi.fn();
        expect((await repairReadWeaveFormat("合格文本", repair)).rounds).toBe(0);
        expect(repair).not.toHaveBeenCalled();
    });
    it("shares the repair allowance with earlier evidence repairs", async () => {
        const repair = vi.fn(async (text: string) => text.replace(/。/gu, ""));
        const result = await repairReadWeaveFormat("第一句。\n\n第二句。", repair, undefined, 1);
        expect(repair).toHaveBeenCalledTimes(1);
        expect(result.rounds).toBe(1);
        repair.mockClear();
        await repairReadWeaveFormat("第一句。", repair, undefined, 0);
        expect(repair).not.toHaveBeenCalled();
    });
    it("retains the original after an unsafe model patch", async () => {
        const result = await repairReadWeaveFormat("不增加。", async () => "增加");
        expect(result.body).toBe("不增加。");
        expect(result.warnings).toHaveLength(1);
    });
});
