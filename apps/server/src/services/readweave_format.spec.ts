import { describe, expect, it, vi } from "vitest";

import {
    applyReadWeaveFormatPatches,
    formatReadWeaveFullNameOpening,
    formatReadWeaveMarkdown,
    formatReadWeavePersonNameOrder,
    readWeaveFormatIssues,
    repairReadWeaveConventionalTerms,
    repairReadWeaveFormat,
    repairReadWeaveOptionalQualifiers} from "./readweave_format.js";

describe("versioned formatting contract", () => {
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
    it.each([ "`ABC`","《ABC Book》","ABC 示例连接（Alpha Beta Connection）","ABC 与 ABC",
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
    it("leaves the question's own acronym to the sourced naming path", async () => {
        const resolve = vi.fn();
        const result = await repairReadWeaveConventionalTerms(
            "ABC 是对象","ABC 的名称来历？",resolve);
        expect(result.rounds).toBe(0);
        expect(resolve).not.toHaveBeenCalled();
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
    it("does not group isolated definitions across a heading or protected block", () => {
        const body = "示例（Example）：一个实例\n\n## 中间标题\n\n分组（Packet）：一组记录"
            + "\n\n> Transfer（传输）：逐字引文。\n\n传输（Transfer）：传递过程";
        expect(formatReadWeaveMarkdown(body)).toBe(body);
        expect(formatReadWeaveMarkdown("Example（示例）：一个实例")).toBe("示例（Example）：一个实例");
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
    it("does not change a single definition to a list", () => {
        expect(formatReadWeaveMarkdown("熵（Entropy）：表示状态的不确定程度")).toBe(
            "熵（Entropy）：表示状态的不确定程度"
        );
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
    it("sends only a failing line and limits local repairs", async () => {
        const repair = vi.fn(async (text: string) => text.replace(/。/gu, ""));
        const body = "第一行。\n\n第二行。\n\n第三行。";
        const result = await repairReadWeaveFormat(body, repair);
        expect(repair).toHaveBeenCalledTimes(2);
        expect(repair.mock.calls.every(([ text ]) => text !== body)).toBe(true);
        expect(result.body).toBe("第一行\n\n第二行\n\n第三行。");
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
