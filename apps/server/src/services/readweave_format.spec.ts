import { describe, expect, it, vi } from "vitest";

import {
    applyReadWeaveFormatPatches,
    formatReadWeaveCodeCopies,
    formatReadWeaveDefinitionBlock,
    formatReadWeaveFullNameOpening,
    formatReadWeaveMarkdown,
    formatReadWeavePersonNameOrder,
    formatReadWeaveTermReferences,
    readWeaveFormatIssues,
    repairReadWeaveConventionalTerms,
    repairReadWeaveFormat,
    repairReadWeaveOptionalQualifiers } from "./readweave_format.js";

describe("versioned formatting contract", () => {
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
        const resolve = vi.fn(async (targets: Array<{ token:string }>) => targets.map(target => ({
            token:target.token,
            chineseName:"示例术语",
            englishName:target.token.split("").map(letter=>`${letter}word`).join(" "),
            confidence:"high",basis:"established-usage",contextReason:"上下文明确"
        })));
        const result = await repairReadWeaveConventionalTerms(body,"这些缩写是什么意思？",resolve);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0][0]).toHaveLength(10);
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
    it("keeps one primary term definition and replaces later bare abbreviations", () => {
        expect(formatReadWeaveTermReferences(
            "- NPU 神经网络处理单元（Neural Processing Unit）：NPU 负责运算；NPU 不是存储器",
            { abbreviation:"NPU",chineseName:"神经网络处理单元",englishName:"Neural Processing Unit" }
        )).toBe("- NPU 神经网络处理单元（Neural Processing Unit）：神经网络处理单元负责运算；神经网络处理单元不是存储器");
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
