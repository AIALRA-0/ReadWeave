import type { ReadWeaveClaim, ReadWeaveEvidenceSource, ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    buildReadWeaveDomainProfile,
    buildReadWeaveEvidencePackSummary,
    enrichReadWeaveClaim,
    enrichReadWeaveEvidenceSource
} from "./readweave_domain_policy.js";

function request(title: string, kind: ReadWeaveGenerateRequest["kind"] = "question"): Pick<ReadWeaveGenerateRequest, "kind" | "title"> {
    return { kind, title };
}

function source(overrides: Partial<ReadWeaveEvidenceSource>): ReadWeaveEvidenceSource {
    return {
        sourceId: "S1",
        sourceType: "external",
        provider: "Official profile",
        title: "Official profile",
        url: "https://example.org/profile",
        excerpt: "Principal Software Engineer at AMD; Ph.D. in Computer Science",
        accessedAt: "2026-09-06T00:00:00.000Z",
        ...overrides
    };
}

describe("ReadWeave domain policy framework", () => {
    it("selects a high-risk identity/current-status profile for a lowercase person query", () => {
        const profile = buildReadWeaveDomainProfile(request("wuxili 是谁？"), "wuxili 是谁？");

        expect(profile.primaryDomain).toBe("identity");
        expect(profile.domains).toEqual(expect.arrayContaining([ "identity", "current-status" ]));
        expect(profile.risk).toBe("high");
        expect(profile.requiredEvidenceTypes).toEqual(expect.arrayContaining([ "current-role", "current-status" ]));
        expect(profile.answerChecks).toContain("separate-role-education-and-authorship");
    });

    it("keeps source authority, fact type and time scope explicit", () => {
        const current = enrichReadWeaveEvidenceSource(source({ excerpt: "Currently Principal Software Engineer at AMD" }));
        const education = enrichReadWeaveEvidenceSource(source({
            sourceId: "S2",
            title: "University profile",
            provider: "University",
            excerpt: "Received a Ph.D. in Computer Science"
        }));

        expect(current.authority).toBe("official");
        expect(current.claimTypes).toContain("current-role");
        expect(current.timeScope).toBe("current");
        expect(education.claimTypes).toContain("education");
        expect(education.claimTypes).not.toContain("current-role");
        expect(education.timeScope).toBe("historical");
    });

    it("preserves first-party personal evidence as self-reported instead of treating it as an independent employer source", () => {
        const enriched = enrichReadWeaveEvidenceSource(source({
            sourceCategory: "first-party-personal",
            evidenceFamily: "SELF",
            title: "Wuxi Li - Homepage",
            excerpt: "Principal Software Engineer at AMD/Xilinx"
        }));

        expect(enriched.authority).toBe("first-party");
        expect(enriched.evidenceFamily).toBe("SELF");
        expect(enriched.sourceCategory).toBe("first-party-personal");
    });

    it("labels claims from the cited evidence instead of inferring current role from education", () => {
        const profile = buildReadWeaveDomainProfile(request("wuxili 是谁？"), "wuxili 是谁？");
        const education = enrichReadWeaveEvidenceSource(source({
            sourceId: "S2",
            title: "University profile",
            provider: "University",
            excerpt: "Received a Ph.D. in Computer Science"
        }));
        const claim: ReadWeaveClaim = {
            claimId: "C1",
            text: "该人物拥有博士学位",
            sourceIds: [ "S2" ],
            confidence: "high"
        };

        const enriched = enrichReadWeaveClaim(claim, [ education ], profile);

        expect(enriched.claimType).toBe("general");
        expect(enriched.timeScope).toBe("historical");
        expect(enriched.status).toBe("supported");
    });

    it("builds a separate local/external evidence pack summary with warnings", () => {
        const sources = [
            enrichReadWeaveEvidenceSource(source({ sourceId: "L1", sourceType: "local", provider: "当前文章", title: "文章片段" })),
            enrichReadWeaveEvidenceSource(source({ sourceId: "S1", sourceType: "external" }))
        ];

        expect(buildReadWeaveEvidencePackSummary(sources, 2, [ "provider timeout", "provider timeout" ])).toEqual({
            version: 1,
            localSourceIds: [ "L1" ],
            externalSourceIds: [ "S1" ],
            sourceCount: 2,
            queryCount: 2,
            warnings: [ "provider timeout" ]
        });
    });
});
