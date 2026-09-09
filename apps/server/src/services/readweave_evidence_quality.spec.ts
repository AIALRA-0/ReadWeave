import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import {
    checkReadWeaveNamingEvidence,
    normalizeReadWeaveEvidenceText,
    omitUnsupportedReadWeaveNaming,
    readWeaveExplicitExpansions,
    readWeaveResearchSubject,
    repairReadWeaveNamingEvidence
} from "./readweave_evidence_quality.js";
describe("naming provenance, not a semantic truth certificate", () => {
    it("extracts the selected entity instead of quoting an instruction as an entity", () => {
        expect(readWeaveResearchSubject("XPT 的官方英文全称是什么？请解释这些词，不要猜测名称来历", "XPT")).toBe("XPT");
        expect(readWeaveResearchSubject("Lumen 的名称来源是什么？")).toBe("Lumen");
        expect(readWeaveResearchSubject("量子点是什么？", "这是一段量子点的背景材料")).toBe("量子点");
    });
    it("recognizes explicit name pairs without inferring a name from a paper title", () => {
        expect(readWeaveExplicitExpansions("**Example Packet Transfer (XPT)**")).toEqual([{ abbreviation: "XPT", englishName: "Example Packet Transfer" }]);
        expect(readWeaveExplicitExpansions("XPT: An Experimental Packet Tool")).toEqual([]);
    });
    it("retains a directly paired full name even if the writer omitted the provenance field", () => {
        const text = "XPT 的官方英文全称是 Example Packet Transfer（示例分组传输）。";
        const checked = checkReadWeaveNamingEvidence(text, [], [{sourceId:"S1", excerpt:"Example Packet Transfer (XPT) provides an example."}] as never);
        expect(checked.issues).toEqual([]);
        expect(checked.supported[0].sourceId).toBe("S1");
        expect(checkReadWeaveNamingEvidence(text.replace("Example", "Invented"), [], [{sourceId:"S1",excerpt:"Example Packet Transfer (XPT)"}] as never).issues).toHaveLength(1);
    });
    const quote = "Lumen is named after the unit of luminous flux";
    const source = { sourceId: "S1", excerpt: quote } as ReadWeaveEvidenceSource;
    const body = "名称源于光通量单位";
    it("accepts a directly traceable naming quote", () => {
        expect(
            checkReadWeaveNamingEvidence(
                body,
                [{ bodyText: body, sourceId: "S1", quote }],
                [source],
            ).issues,
        ).toEqual([]);
    });
    it.each(
        [
            [],
            [{ bodyText: body, sourceId: "S2", quote }],
            [{ bodyText: body, sourceId: "S1", quote: "unrelated invented quote" }],
        ].map((evidence) => ({ evidence })),
    )("rejects missing or invented provenance $evidence", ({ evidence }) => {
        expect(checkReadWeaveNamingEvidence(body, evidence, [source]).issues).toEqual([body]);
    });
    it("rejects speculation even if it cites an existing source", () => {
        const text = "名称可能源于某个英语词";
        expect(
            checkReadWeaveNamingEvidence(
                text,
                [{ bodyText: text, sourceId: "S1", quote }],
                [source],
            ).issues,
        ).toEqual([text]);
    });
    it("removes only an unsupported clause, without changing the surrounding facts", () => {
        const text = "用于照明测量；名称可能源于某个英语词；不表示能量";
        const checked = checkReadWeaveNamingEvidence(text, [], []);
        expect(omitUnsupportedReadWeaveNaming(text, checked.issues)).toBe(
            "用于照明测量；不表示能量",
        );
    });
    it("does not classify every ordinary definition as a naming claim", () => {
        expect(checkReadWeaveNamingEvidence("光通量是描述光源输出的量", [], []).issues).toEqual([]);
    });
    it("checks reversed naming assertions and invented dates", () => {
        const text = "Lumen 的作者以光通量单位命名该工具";
        const quote = "The author decided to call the tool Lumen after the light unit";
        const source = { sourceId: "S1", excerpt: quote } as ReadWeaveEvidenceSource;
        expect(checkReadWeaveNamingEvidence(text, [], [ source ]).issues).toEqual([ text ]);
        expect(checkReadWeaveNamingEvidence(text,
            [ { bodyText: text, sourceId: "S1", quote } ], [ source ]).issues).toEqual([]);
        const dated = text.replace("以", "于 1987 年以");
        expect(checkReadWeaveNamingEvidence(dated,
            [ { bodyText: dated, sourceId: "S1", quote } ], [ source ]).issues).toEqual([ dated ]);
    });
    it("rejects the user-reported reversed abbreviation syntax", () => {
        const text = "名称中的 AURORA 是 Automatic Unverified...(具体展开未在证据中给出)的缩写，但证据未提供官方全称，因此无法确认其确切含义";
        expect(checkReadWeaveNamingEvidence(text, [], []).issues).toEqual([text]);
    });
    it("matches visible link labels and typographic quotes", () => {
        const decision = " She decided to call the tool Lumen after this story.";
        const excerpt = `The author was reading [“Light’s Journey”](https://example.org/light).${
            decision}`;
        const quote = `The author was reading "Light's Journey".${  decision}`;
        const body = "Lumen 的名称来源于故事《Light's Journey》。";
        const checked = checkReadWeaveNamingEvidence(body,
            [ { bodyText: body, sourceId: "S1", quote } ],
            [ { sourceId: "S1", excerpt } ] as ReadWeaveEvidenceSource[]);
        expect(checked.issues).toEqual([]);
        expect(normalizeReadWeaveEvidenceText(excerpt)).toBe(quote);
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText: body, sourceId: "S1", quote: quote.replace("story", "poem") } ],
            [ { sourceId: "S1", excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([ body ]);
    });
    it("does not use words hidden in a link destination or flatten distinct names", () => {
        const excerpt = "Lumen is named after [a light unit](https://example.org/Invented).";
        const body = "Lumen 的名称源于 Invented";
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText: body, sourceId: "S1", quote: excerpt } ],
            [ { sourceId: "S1", excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([ body ]);
        const accented = "Lumen is named after Söder";
        expect(checkReadWeaveNamingEvidence("Lumen 得名于 Soder",
            [ { bodyText:"Lumen 得名于 Soder", sourceId:"S1", quote:accented } ],
            [ { sourceId:"S1",excerpt:accented } ] as ReadWeaveEvidenceSource[]).issues)
            .toHaveLength(1);
    });
    it("removes linked footnote numbers without treating them as factual dates", () => {
        const excerpt = "Lumen is named after a light unit"
            + "[[1987]](https://example.org/#cite_note-1987).";
        const body = "Lumen 得名于光通量单位。";
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText:body,sourceId:"S1",quote:"Lumen is named after a light unit." } ],
            [ { sourceId:"S1",excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([]);
        const dated = "Lumen 于 1987 年得名于光通量单位。";
        expect(checkReadWeaveNamingEvidence(dated,
            [ { bodyText:dated,sourceId:"S1",quote:excerpt } ],
            [ { sourceId:"S1",excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([ dated ]);
    });
    it("completes an adjacent naming decision without a model call", async () => {
        const quote = 'While building Lumen, the author read "Light Stories".';
        const decision = " She decided to call the tool Lumen after the story.";
        const body = "Lumen 的名称来自 Light Stories。";
        const repair = vi.fn();
        const result = await repairReadWeaveNamingEvidence(body,
            [ { bodyText:body, sourceId:"S1", quote } ],
            [ { sourceId:"S1", excerpt:quote + decision } ] as ReadWeaveEvidenceSource[], repair);
        expect(result.body).toBe(body);
        expect(result.check.issues).toEqual([]);
        expect(result.check.supported[0].quote).toBe(quote + decision);
        expect(repair).not.toHaveBeenCalled();
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText:body, sourceId:"S1", quote:quote.slice(0, -1) } ],
            [ { sourceId:"S1", excerpt:quote + decision } ] as ReadWeaveEvidenceSource[]
        ).issues).toEqual([]);
        for (const separator of [ " ## Another subject ", " Unrelated. " ]) {
            expect(checkReadWeaveNamingEvidence(body,
                [ { bodyText:body, sourceId:"S1", quote } ],
                [ { sourceId:"S1", excerpt:quote + separator + decision }
                ] as ReadWeaveEvidenceSource[]
            ).issues).toEqual([ body ]);
        }
    });
    it("rejects speculative source text even when the output hides its uncertainty", () => {
        const excerpt = "Lumen was perhaps named after the light unit";
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText: body, sourceId: "S1", quote: excerpt } ],
            [ { sourceId: "S1", excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([ body ]);
    });
    it("does not let a supported substring approve unrelated facts in the same sentence", () => {
        const fragment = "Lumen 的名称源于光通量单位";
        const full = `${fragment}，由 Invented 于 1987 年提出。`;
        expect(checkReadWeaveNamingEvidence(full,
            [ { bodyText:fragment,sourceId:"S1",quote } ], [ source ]).issues).toEqual([ full ]);
    });
    it("removes an unsupported sentence atomically instead of leaving a dangling phrase", () => {
        const text = "Lumen 用于测量。开发者先讨论了光照，然后提出了这一名称，灵感来自未知故事。";
        const checked = checkReadWeaveNamingEvidence(text, [], []);
        expect(checked.issues).toEqual([ "开发者先讨论了光照，然后提出了这一名称，灵感来自未知故事。" ]);
        expect(omitUnsupportedReadWeaveNaming(text, checked.issues)).toBe("Lumen 用于测量。");
    });
    it("accepts an explicitly negative abbreviation statement, not a guessed expansion", () => {
        const excerpt = "Lumen is not an acronym and doesn't stand for anything";
        const body = "Lumen 并非缩写";
        expect(checkReadWeaveNamingEvidence(body,
            [ { bodyText:body, sourceId:"S1", quote:excerpt } ],
            [ { sourceId:"S1", excerpt } ] as ReadWeaveEvidenceSource[]).issues).toEqual([]);
    });
    it("repairs only the faulty sentence once and preserves all other bytes", async () => {
        const faulty = "Lumen 于 1987 年得名于光通量单位。";
        const replacement = "Lumen 得名于光通量单位。";
        const text = `第一段不动。\n${faulty}\n第三段不动。`;
        const repair = vi.fn(async () => [ { original:faulty,replacement,
            namingEvidence:[ { bodyText:replacement,sourceId:"S1",quote } ] } ]);
        const result = await repairReadWeaveNamingEvidence(text, [], [ source ], repair);
        expect(repair).toHaveBeenCalledExactlyOnceWith([ faulty ], []);
        expect(result.body).toBe(`第一段不动。\n${replacement}\n第三段不动。`);
        expect(result.check.issues).toEqual([]);
        expect(result.removed).toEqual([ faulty ]);
        expect(result.rounds).toBe(1);
    });
    it.each([ "whole answer", "invented quote", "empty replacement" ])(
        "rejects a %s patch without a retry", async mode => {
            const faulty = "Lumen 于 1987 年得名于光通量单位。";
            const replacement = mode === "empty replacement" ? "" : "Lumen 得名于光通量单位。";
            const text = `前文。${faulty}后文。`;
            const repair = vi.fn(async () => [ {
                original:mode === "whole answer" ? text : faulty, replacement,
                namingEvidence:[ { bodyText:replacement,sourceId:"S1",
                    quote:mode === "invented quote"
                        ? "Lumen is named after an invented place" : quote } ]
            } ]);
            const result = await repairReadWeaveNamingEvidence(text, [], [ source ], repair);
            expect(result.body).toBe(text);
            expect(result.warnings).toHaveLength(1);
            expect(repair).toHaveBeenCalledTimes(1);
        }
    );
    it("does not spend on valid text or after cancellation", async () => {
        const repair = vi.fn();
        expect((await repairReadWeaveNamingEvidence("已知事实", [], [], repair)).rounds).toBe(0);
        const controller = new AbortController();
        controller.abort();
        await expect(repairReadWeaveNamingEvidence(
            "Lumen 得名于未知故事。", [], [], repair, controller.signal
        )).rejects.toThrow();
        expect(repair).not.toHaveBeenCalled();
    });
    it("keeps a valid core patch when an optional patch lacks evidence", async () => {
        const first = "Lumen 于 1987 年得名于光通量单位。";
        const second = "Lumen 的名称来源于 Invented 在 1988 年提出的故事。";
        const replacement = "Lumen 得名于光通量单位。";
        const repair = vi.fn(async () => [
            { original:first,replacement,
                namingEvidence:[ { bodyText:replacement,sourceId:"S1",quote } ] },
            { original:second,replacement:second,
                namingEvidence:[ { bodyText:second,sourceId:"S1",quote } ] }
        ]);
        const result = await repairReadWeaveNamingEvidence(first + second, [], [ source ], repair);
        expect(result.body).toBe(replacement + second);
        expect(result.check.issues).toEqual([ second ]);
        expect(result.warnings).toHaveLength(1);
    });
    it("allows terminal punctuation differences in a complete repaired sentence", async () => {
        const original = "Lumen 于 1987 年得名于光通量单位。";
        const replacement = "Lumen 得名于光通量单位。";
        const repair = vi.fn(async () => [ { original,replacement,namingEvidence:[ {
            bodyText:replacement.slice(0,-1),sourceId:"S1",quote
        } ] } ]);
        const result = await repairReadWeaveNamingEvidence(original,
            [ { bodyText:original,sourceId:"S1",quote } ], [ source ], repair);
        expect(repair.mock.calls).toHaveLength(1);
        expect(result.body).toBe(replacement);
        expect(result.warnings).toEqual([]);
        expect(checkReadWeaveNamingEvidence(original,
            [ { bodyText:original,sourceId:"S1",quote } ], [ source ]).diagnostics.join(" "))
            .toContain("数字");
    });
});
