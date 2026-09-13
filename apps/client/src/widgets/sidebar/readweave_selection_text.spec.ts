import { describe, expect, it } from "vitest";

import { readWeaveSelectionTextForRange } from "./readweave_selection_text.js";

describe("rendered article selection", () => {
    it("takes one TeX source instead of KaTeX's two rendered trees", () => {
        const root = document.createElement("p");
        root.innerHTML = '误差函数 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">f(\\phi(x_i;w),y_i)</annotation></math></span><span class="katex-html" aria-hidden="true">f(ϕ(xi;w),yi)</span></span> 是什么';
        const range = document.createRange();
        range.selectNodeContents(root);
        expect(readWeaveSelectionTextForRange(range)).toBe("误差函数 $f(\\phi(x_i;w),y_i)$ 是什么");
    });

    it("snaps a partial visual selection to the whole source formula", () => {
        const root = document.createElement("p");
        root.innerHTML = '<span data-tex="x_i^2"><span>xi2</span></span>';
        const range = document.createRange();
        const text = root.querySelector("span span")!.firstChild!;
        range.setStart(text, 1);
        range.setEnd(text, 2);
        expect(readWeaveSelectionTextForRange(range)).toBe("$x_i^2$");
    });

    it("preserves display math and adjacent text in order", () => {
        const root = document.createElement("div");
        root.innerHTML = '前 <span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">a+b</annotation></span></span> 后';
        const range = document.createRange();
        range.selectNodeContents(root);
        expect(readWeaveSelectionTextForRange(range)).toBe("前 $$a+b$$ 后");
    });

    it("normalizes an unrendered math-tex span to Markdown math", () => {
        const root = document.createElement("p");
        root.innerHTML = '前 <span class="math-tex">\\(x_i^2+y_i^2\\)</span> 后';
        const range = document.createRange();
        range.selectNodeContents(root);
        expect(readWeaveSelectionTextForRange(range)).toBe("前 $x_i^2+y_i^2$ 后");
    });
});
