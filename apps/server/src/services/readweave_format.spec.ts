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
    formatReadWeavePersonNameOrder,
    formatReadWeaveTermReferences,
    readWeaveFormatIssues,
    readWeaveNameReviewTargets,
    repairReadWeaveConventionalTerms,
    repairReadWeaveFormat,
    repairReadWeaveOptionalQualifiers } from "./readweave_format.js";
import { HUMAN_READABLE_CHINESE_STYLE_CONTRACT } from "./readweave_style_contract.js";

describe("versioned formatting contract", () => {
    it("moves a supplied non-acronym alias out of the English name in both fields", () => {
        const label = "布局消解（Layout Resolution，也称 布局解析）";
        const question = `${label}是什么？`;
        const definition = `- ${label}：用于分析布局；仅在 2 个条件下适用；不能改变顺序`;
        const expectedQuestion = "布局消解（Layout Resolution）（也称 布局解析）是什么？";
        const expectedDefinition = "- 布局消解（Layout Resolution）：也称 布局解析；用于分析布局；仅在 2 个条件下适用；不能改变顺序";
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
            [ { token: "IP", before: "", after: " 用于网络传输" } ], { question }
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
    it("normalizes every generated answer heading and labels an orphan opening", () => {
        expect(formatReadWeaveAnswerHeadings(
            "直接回答\n\n# 原理\n\n正文\n\n## 边界\n\n说明"
        )).toBe("### 回答\n\n直接回答\n\n### 原理\n\n正文\n\n### 边界\n\n说明");
        expect(formatReadWeaveAnswerHeadings("只有一个连续语义块")).toBe("只有一个连续语义块");
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
