import { describe, expect, it } from "vitest";

import {
    calloutAfterKindChange,
    isReadWeaveGenerationDisabled,
    normalizeReadWeaveTermIdentityForReview,
    READWEAVE_CANDIDATE_LIMIT,
    READWEAVE_CANDIDATE_MIN_CONFIDENCE,
    visibleReadWeaveCandidates
} from "./readweave_panel_state.js";

describe("ReadWeave panel state", () => {
    it("switches semantic defaults with the kind while retaining an explicit emphasis style", () => {
        expect(calloutAfterKindChange("note", "term")).toBe("tip");
        expect(calloutAfterKindChange("tip", "question")).toBe("note");
        expect(calloutAfterKindChange("important", "term")).toBe("important");
        expect(calloutAfterKindChange("warning", "question")).toBe("warning");
        expect(calloutAfterKindChange("caution", "term")).toBe("caution");
    });

    it("shows only the three strongest relevant reuse candidates", () => {
        const visible = visibleReadWeaveCandidates([
            { objectId: "low", kind: "term", title: "low", confidence: READWEAVE_CANDIDATE_MIN_CONFIDENCE - 0.001, reuseRecommended: false },
            { objectId: "threshold", kind: "term", title: "threshold", confidence: READWEAVE_CANDIDATE_MIN_CONFIDENCE, reuseRecommended: false },
            { objectId: "third", kind: "term", title: "third", confidence: 0.7, reuseRecommended: false },
            { objectId: "first", kind: "term", title: "first", confidence: 0.95, reuseRecommended: true },
            { objectId: "fourth", kind: "term", title: "fourth", confidence: 0.6, reuseRecommended: false },
            { objectId: "second", kind: "term", title: "second", confidence: 0.8, reuseRecommended: false }
        ]);

        expect(visible).toHaveLength(READWEAVE_CANDIDATE_LIMIT);
        expect(visible.map(candidate => candidate.objectId)).toEqual([ "first", "second", "third" ]);
    });

    it("keeps completed and failed drafts retryable but blocks active jobs", () => {
        const base = {
            busy: false,
            definitionExists: false,
            hasSelection: true,
            hasTitle: true,
            selectionPending: false
        };
        expect(isReadWeaveGenerationDisabled({ ...base, jobStatus: "complete" })).toBe(false);
        expect(isReadWeaveGenerationDisabled({ ...base, jobStatus: "failed" })).toBe(false);
        expect(isReadWeaveGenerationDisabled({ ...base, jobStatus: "queued" })).toBe(true);
        expect(isReadWeaveGenerationDisabled({ ...base, jobStatus: "running" })).toBe(true);
        expect(isReadWeaveGenerationDisabled({ ...base, hasTitle: false })).toBe(true);
    });

    it("repairs legacy method identities before review without changing real abbreviations", () => {
        expect(normalizeReadWeaveTermIdentityForReview({
            abbreviation: "BS-PDN-Last",
            chineseName: "BS-PDN-Last 电源分配网络设计方法",
            englishName: "BS-PDN-Last"
        })).toEqual({
            abbreviation: undefined,
            chineseName: "电源分配网络设计方法",
            englishName: "BS-PDN-Last"
        });
        expect(normalizeReadWeaveTermIdentityForReview({
            abbreviation: "ORCID",
            chineseName: "开放研究者与贡献者标识符",
            englishName: "Open Researcher and Contributor ID"
        })).toEqual({
            abbreviation: "ORCID",
            chineseName: "开放研究者与贡献者标识符",
            englishName: "Open Researcher and Contributor ID"
        });
    });
});
