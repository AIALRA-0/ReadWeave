import { describe, expect, it, vi } from "vitest";

import {
    applyReadWeaveFormatPatches,
    formatReadWeaveFullNameOpening,
    formatReadWeaveMarkdown,
    repairReadWeaveFormat
} from "./readweave_format.js";

describe("versioned formatting contract", () => {
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
