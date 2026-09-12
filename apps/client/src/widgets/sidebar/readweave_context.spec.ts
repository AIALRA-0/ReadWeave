import { describe, expect, it } from "vitest";
import { collectReadWeaveFragments, readWeaveContextText } from "./readweave_context.js";

function article(html: string) {
    const root = document.createElement("article");
    root.innerHTML = html;
    return root;
}

describe("complete ReadWeave article context", () => {
    it("retains exact selection, its full containing block, and tails beyond every old limit", () => {
        const long = "source ".repeat(15000) + "BLOCK TAIL";
        const root = article(`<h2>Heading</h2><p>${long}</p>${Array.from({ length: 180 }, (_, i) => `<p>block ${i}</p>`).join("")}<div>UNCLASSIFIED TAIL</div>bare text tail`);
        const fragments = collectReadWeaveFragments(root, root.querySelector("p")!, " exact\n  selected &amp; text ");
        expect(fragments[0]).toEqual({ id: "selected", role: "selected", text: " exact\n  selected &amp; text " });
        expect(fragments.find(item => item.id === "current-block")).toMatchObject({ role: "section", text: `<p>${long}</p>` });
        expect(fragments.map(item => item.text).join("\n")).toContain("block 179");
        expect(fragments.at(-1)?.text).toBe("bare text tail");
        expect(fragments.map(item => item.text).join("\n")).toContain("UNCLASSIFIED TAIL");
    });

    it("keeps nested list/code structure and table header/cell relationships", () => {
        const root = article('<h2>Results</h2><table><caption>Units</caption><thead><tr><th id="unit" colspan="2" scope="col">Size</th></tr></thead><tbody><tr><td headers="unit" rowspan="2">16</td><td>nm</td></tr><tr><td>um</td></tr></tbody></table><ul><li>One<ul><li>Nested</li></ul></li></ul><pre>line 1\n  line 2</pre>');
        const fragments = collectReadWeaveFragments(root, root.querySelector("td")!, "16");
        const current = fragments.find(item => item.id === "current-block")!.text;
        expect(current).toContain('<th colspan="2" scope="col" id="unit">Size</th>');
        expect(current).toContain('<td rowspan="2" headers="unit">16</td>');
        expect(current).toContain("<caption>Units</caption>");
        expect(fragments.map(item => item.text).join("\n")).toContain("<ul><li>One<ul><li>Nested</li></ul></li></ul>");
        expect(fragments.at(-1)?.text).toBe("<pre>line 1\n  line 2</pre>");
    });

    it("emits one TeX source per rendered occurrence without deleting repeated prose or formulas", () => {
        const math = '<span class="math-tex"><span class="katex"><span class="katex-mathml"><math><semantics><mi>visual</mi><annotation encoding="application/x-tex">x^{2}</annotation></semantics></math></span><span class="katex-html">visual duplicate</span></span></span>';
        const root = article(`<p>Before ${math} after ${math} end</p>`);
        const text = readWeaveContextText(root.firstElementChild);
        expect(text).toBe("<p>Before $x^{2}$ after $x^{2}$ end</p>");
        expect(root.textContent).toContain("visual duplicate");
    });

    it("preserves repeated block positions and longer blocks without collapsing distinct contexts", () => {
        const root = article("<p>same</p><p>same</p><p>same plus tail</p><p>same  plus tail</p>");
        const fragments = collectReadWeaveFragments(root, root.firstElementChild as HTMLElement, "same");
        expect(fragments.filter(item => item.text === "<p>same</p>")).toHaveLength(3);
        expect(fragments.filter(item => item.role === "document")).toHaveLength(4);
        expect(fragments.map(item => item.text)).toContain("<p>same plus tail</p>");
        expect(fragments.map(item => item.text)).toContain("<p>same  plus tail</p>");
    });
});
