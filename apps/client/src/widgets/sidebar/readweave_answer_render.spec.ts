import { describe, expect, it } from "vitest";

import { normalizeReadWeaveNumberedHeadings, renderAnswerMarkdown } from "./ReadWeaveAnswer.js";

describe("ReadWeave answer Markdown rendering", () => {
    it("renders a blank-line-separated numbered title as a heading without list indentation", () => {
        const body = "1. Innovus 是什么\n\nInnovus 是数字实现工具\n\n- 普通列表项\n  - 嵌套列表项";
        const html = renderAnswerMarkdown(body);

        expect(html).toContain("Innovus 是什么");
        expect(normalizeReadWeaveNumberedHeadings(body)).toContain("## 1. Innovus 是什么");
        expect(html).toContain("<ul>\n<li>普通列表项<ul>");
    });

    it("keeps a bullet directly below a numbered title outside the heading", () => {
        const body = "1. Innovus 是什么\n\n- Cadence Innovus 实现系统\n  - 子项";
        const normalized = normalizeReadWeaveNumberedHeadings(body);

        expect(normalized).toBe("## 1. Innovus 是什么\n\n- Cadence Innovus 实现系统\n  - 子项");
        const html = renderAnswerMarkdown(body);
        expect(html).toContain("1. Innovus 是什么\n<ul>");
        expect(html).not.toContain("<ol>");
    });

    it("keeps ordinary ordered and nested list items as lists", () => {
        const html = renderAnswerMarkdown("1. 普通列表项\n2. 第二项\n\n- 外层\n  - 嵌套");

        expect(normalizeReadWeaveNumberedHeadings("1. 普通列表项\n2. 第二项")).toBe("1. 普通列表项\n2. 第二项");
        expect(html).toContain("<li>普通列表项</li>");
        expect(html).toContain("<li>外层<ul>\n<li>嵌套</li>");
        expect(html).not.toContain("<h2>");
    });
});
