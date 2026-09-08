import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    checkReadWeaveNamingEvidence,
    omitUnsupportedReadWeaveNaming,
} from "./readweave_evidence_quality.js";
describe("naming provenance, not a semantic truth certificate", () => {
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
    it("rejects the user-reported reversed abbreviation syntax", () => {
        const text = "名称中的 AURORA 是 Automatic Unverified...(具体展开未在证据中给出)的缩写，但证据未提供官方全称，因此无法确认其确切含义";
        expect(checkReadWeaveNamingEvidence(text, [], []).issues).toEqual([text]);
    });
});
