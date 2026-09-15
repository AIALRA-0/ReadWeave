import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { applyReadWeaveExplicitExclusions, boundReadWeaveUnsupportedNaming, repairReadWeaveNamingDates } from "./readweave_local_scope_repairs.js";

const original = "Lumen 于 1987 年得名于光通量单位。";
const replacement = "Lumen 得名于光通量单位。";
const quote = "Lumen is named after a light unit";
const source = (excerpt = quote): ReadWeaveEvidenceSource => ({
    sourceId: "S1", sourceType: "external", provider: "fixture", title: "Naming record",
    excerpt, accessedAt: "2026-09-15T00:00:00Z"
});
const evidence = (bodyText = original, citedQuote = quote) => [{ bodyText, sourceId: "S1", quote: citedQuote }];

describe("free local naming repair", () => {
    it("does not repair a same-suffix entity from partial evidence metadata", () => {
        const body = `Other${original}`;
        expect(repairReadWeaveNamingDates(body, evidence(), [source()]).body).toBe(body);
    });

    it("does not bound half a naming clause across inline protected data", () => {
        const body = "Lumen 得名于 `light` 且支持采样。";
        expect(boundReadWeaveUnsupportedNaming(body, [body]).body).toBe(body);
    });

    it("does not match another entity's issue by suffix", () => {
        const body = "Lumen 得名于光通量单位。";
        expect(boundReadWeaveUnsupportedNaming(body, [`Other${body}`]).body).toBe(body);
    });

    it("removes only the unsupported date and keeps the supported origin and sibling bytes", () => {
        const body = `${original}\r\n\r\n实验在 1987 年完成；其结果仍不确定。`;
        const result = repairReadWeaveNamingDates(body, evidence(), [source()]);
        expect(result.body).toBe(body.replace(original, replacement));
        expect(result.check.issues).toEqual([]);
        expect(result.check.supported).toEqual(expect.arrayContaining([expect.objectContaining({ bodyText: replacement, sourceId: "S1" })]));
        expect(result.rounds).toBe(1);
    });

    it("retains a date actually present in the quote", () => {
        const datedQuote = `${quote} in 1987`;
        expect(repairReadWeaveNamingDates(original, evidence(original, datedQuote), [source(datedQuote)]).body).toBe(original);
    });

    it.each([
        ["missing source", []],
        ["mismatched quote", [source("Lumen is named after something else")]],
    ])("does not adopt a correction with %s", (_label, sources) => {
        expect(repairReadWeaveNamingDates(original, evidence(), sources as ReadWeaveEvidenceSource[]).body).toBe(original);
    });

    it("does not cure wrong-entity evidence by deleting a date", () => {
        const wrong = "OtherTool is named after a light unit";
        expect(repairReadWeaveNamingDates(original, evidence(original, wrong), [source(wrong)]).body).toBe(original);
    });

    it("does not use a negative naming quote as support for a positive origin", () => {
        const negative = "Lumen is not named after a light unit";
        expect(repairReadWeaveNamingDates(original, evidence(original, negative), [source(negative)]).body).toBe(original);
    });

    it("preserves surrounding uncertainty even when raw evidence omits that qualifier", () => {
        const body = `如果资料属实，${original}`;
        expect(repairReadWeaveNamingDates(body, evidence(), [source()]).body).toBe(body);
    });

    it("corrects only the prose occurrence, preserving an identical code sibling", () => {
        const body = `${original}\n\n\`${original}\``;
        expect(repairReadWeaveNamingDates(body, evidence(), [source()]).body).toBe(`${replacement}\n\n\`${original}\``);
    });

    it.each([undefined, null, {}, [null], [{ bodyText: 3 }]])("accepts raw unknown evidence safely: %j", raw => {
        expect(repairReadWeaveNamingDates(original, raw, [source()]).body).toBe(original);
    });

    it.each([
        `可能${original}`, `如果资料属实，${original}`, `尚无法确认${original}`,
        `\`${original}\``, `“${original}”`, `> ${original}`, `\`\`\`text\n${original}\n\`\`\``,
        `$${original}$`
    ])("preserves uncertainty and protected content: %s", body => {
        expect(repairReadWeaveNamingDates(body, evidence(body), [source()]).body).toBe(body);
        expect(boundReadWeaveUnsupportedNaming(body, [body]).body).toBe(body);
    });

    it("does not leave the fabricated year in the no-evidence fallback", () => {
        const body = `${original}\n\n另一个事实应原样保留。`;
        const result = boundReadWeaveUnsupportedNaming(body, [original]);
        expect(result.body).toContain("Lumen 名称来源尚无法核实");
        expect(result.body).not.toContain("1987");
        expect(result.body).not.toContain("得名于光通量单位");
        expect(result.body.endsWith("\n\n另一个事实应原样保留。")).toBe(true);
    });
});

describe("literal explicit exclusions", () => {
    const instructions = ["只解释访问路径，不列出内部编号，也不介绍日志组件职责"];
    const core = "缓存命中时直接读取副本，未命中时访问原始数据并回填";

    it("does not split a literal name at an internal Chinese conjunction", () => {
        const body = "组织是由多个成员构成的共同体。共和组织是一个虚构名称。";
        expect(applyReadWeaveExplicitExclusions(body, ["不介绍共和组织"]).body).toBe("组织是由多个成员构成的共同体。");
    });

    it.each(["如果不用排错，不列出内部编号", "不列出内部编号？"])("does not treat conditional or interrogative wording as an unconditional exclusion: %s", instruction => {
        const body = "内部编号为 0xAB12。";
        expect(applyReadWeaveExplicitExclusions(body, [instruction]).body).toBe(body);
    });

    it.each(["内部编号为 0xAB12 时，需要检查缓存。", "没有证据表明，内部编号为 0xAB12。", "内部编号为 0xAB12 吗？"])(
        "preserves conditional and negated assertion context: %s", body => {
            expect(applyReadWeaveExplicitExclusions(body, instructions).body).toBe(body);
        }
    );

    it("removes only excluded clauses, preserving sibling paragraphs byte-for-byte", () => {
        const body = `${core}\r\n\r\n内部编号为 0xAB12；日志组件负责归档诊断事件\r\n\r\n过期时必须更新副本。`;
        const result = applyReadWeaveExplicitExclusions(body, instructions);
        expect(result.body).toBe(`${core}\r\n\r\n\r\n\r\n过期时必须更新副本。`);
        expect(result.replacements).toHaveLength(2);
    });

    it("preserves other facts in the same paragraph", () => {
        const body = `内部编号为 0xAB12，${core}；日志组件负责归档诊断事件。过期时更新副本。`;
        expect(applyReadWeaveExplicitExclusions(body, instructions).body).toBe(`${core}；过期时更新副本。`);
    });

    it("does not turn a general scope instruction into a category filter", () => {
        const body = "内部编号为 0xAB12；日志组件负责归档诊断事件";
        expect(applyReadWeaveExplicitExclusions(body, ["不增加用户未问的范围", "只说明核心机制"]).body).toBe(body);
        expect(applyReadWeaveExplicitExclusions(body, []).body).toBe(body);
    });

    it.each([
        "日志组件在 1987 年发布", "内部编号不是身份验证凭据", "没有证据证明内部编号为 0xAB12",
        "内部编号为 0xAB12 且缓存命中时读取副本", "内部编号与访问权限没有必然关系",
        "`内部编号为 0xAB12`", "“内部编号为 0xAB12”", "> 内部编号为 0xAB12",
        "```text\n内部编号为 0xAB12\n```", "$内部编号为 0xAB12$",
        "内部编号为 `0xAB12`", "内部编号为 0xAB12 `且缓存命中时读取副本`"
    ])("does not remove other meanings or protected data: %s", body => {
        expect(applyReadWeaveExplicitExclusions(body, instructions).body).toBe(body);
    });

    it.each(["如果可能，不列出内部编号吗", "引用指令：不列出内部编号", "“不列出内部编号”", "`不列出内部编号`"])(
        "does not treat quoted or non-directive text as authority: %s", instruction => {
            const body = "内部编号为 0xAB12";
            expect(applyReadWeaveExplicitExclusions(body, [instruction]).body).toBe(body);
        }
    );

    it("does not produce an empty answer when every clause is explicitly excluded", () => {
        const result = applyReadWeaveExplicitExclusions("内部编号为 0xAB12", instructions);
        expect(result.body).not.toContain("0xAB12");
        expect(result.body.trim()).not.toBe("");
    });
});
