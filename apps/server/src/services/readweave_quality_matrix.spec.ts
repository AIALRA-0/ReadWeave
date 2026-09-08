import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { checkReadWeaveNamingEvidence, omitUnsupportedReadWeaveNaming } from "./readweave_evidence_quality.js";
import { formatReadWeaveMarkdown } from "./readweave_format.js";
import { readWeaveMissingNamingFacts } from "./readweave_research.js";

// Synthetic, held-out evidence packets, not factual claims about real products
// and not a substitute for live model quality evaluation. No user article or
// user-reported failed name appears in this matrix.
const domains = [
    ["astronomy", "Aster", "star"],
    ["ecology", "Canopy", "forest"],
    ["linguistics", "Lexica", "dictionary"],
    ["materials", "Lattice", "crystal"],
    ["music", "Cadence", "rhythm"],
    ["history", "Chronicle", "record"],
    ["mathematics", "Vertex", "corner"],
    ["software", "Nimbus", "cloud"]
];

describe.each(domains)("independent evidence packet: %s", (_domain, subject, origin) => {
    const quote = `${subject} is not an acronym. ${subject} is named after a ${origin}`;
    const source = { sourceId: "S1", excerpt: quote } as ReadWeaveEvidenceSource;
    const body = `${subject} 的名称源自 ${origin}`;

    it("retains a directly quoted naming fact", () => {
        const result = checkReadWeaveNamingEvidence(body, [{ bodyText: body, sourceId: "S1", quote }], [source]);
        expect(result.issues).toEqual([]);
        expect(readWeaveMissingNamingFacts([source], subject)).toEqual([]);
    });

    it("rejects an invented expansion even with a real source ID", () => {
        const invented = `${subject} 的全称是 Invented General Framework`;
        expect(checkReadWeaveNamingEvidence(invented, [{ bodyText: invented, sourceId: "S1", quote }], [source]).issues).toEqual([invented]);
    });

    it("does not borrow another entity's naming evidence", () => {
        const other = { ...source, excerpt: "Other is not an acronym. Other is named after a tree" };
        expect(readWeaveMissingNamingFacts([other], subject)).toHaveLength(2);
        expect(checkReadWeaveNamingEvidence(body, [{ bodyText: body, sourceId: "S1", quote: other.excerpt }], [other]).issues).toEqual([body]);
    });

    it("does not turn a missing origin into a speculative story", () => {
        const answer = `保留测量值 12，名称 ${subject} 可能源自 ${origin}`;
        const checked = checkReadWeaveNamingEvidence(answer, [], [source]);
        expect(checked.issues).toHaveLength(1);
        expect(omitUnsupportedReadWeaveNaming(answer, checked.issues)).toBe("保留测量值 12");
    });

    it("keeps numbers, negation, code and URLs while rendering structure", () => {
        const protectedText = `不得超过 12\n\n\`const ${subject} = 12;\`\n\nhttps://example.org/${subject}?a=1&b=2`;
        const output = formatReadWeaveMarkdown(protectedText);
        expect(output).toBe(protectedText);
        expect(formatReadWeaveMarkdown(output)).toBe(output);
    });
});
