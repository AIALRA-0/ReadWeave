import { describe, expect, it } from "vitest";
import { readWeaveCompleteContext } from "./readweave_context.js";
import { selectReadWeaveContext } from "./readweave_engine.js";

describe("complete article context", () => {
    it("preserves text after the former 80000-character cap and every block after 300", () => {
        const article = `${"unrelated introduction\n".repeat(4000)}LAST-BLOCK: a kernel computes wirelength gradients`;
        const fragments = [
            { id:"selected", role:"selected" as const, text:"kernel" },
            { id:"document", role:"document" as const, text:article },
            ...Array.from({ length:305 }, (_,index)=>({ id:`block-${index}`, role:"document" as const, text:`unique ${index}` }))
        ];
        const result = selectReadWeaveContext("kernel", fragments, 800);
        expect(result.fragments).toEqual(fragments);
        const packed = readWeaveCompleteContext(result.fragments);
        expect(packed).toContain(article);
        expect(packed).toContain("unique 304");
        expect(result.decision.fragmentIds).toHaveLength(307);
    });

    it("uses exact references for repeated content without changing code or math", () => {
        const block = "计算 $A x = b$\n```python\n  x = 1\n```";
        const packed = readWeaveCompleteContext([
            { id:"selected",role:"selected",text:"$A x = b$" },
            { id:"current-block",role:"section",text:block },
            { id:"document",role:"document",text:`开始\n${block}\n结束` }
        ]);
        expect(packed).toContain(block);
        expect(packed.split(block)).toHaveLength(2);
        expect(packed).toContain("[selected:selected] = [section:current-block]");
        expect(packed).toContain("[section:current-block] = [document:document]");
        expect(packed).toContain("结束");
    });
});
