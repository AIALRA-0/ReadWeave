import type { ReadWeaveGenerationJob } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    calloutAfterKindChange,
    createReadWeaveReviewIssueBaseline,
    isReadWeaveGenerationDisabled,
    isReadWeaveReviewSaveAllowed,
    mergeReadWeaveGenerationJobSnapshot,
    normalizeReadWeaveReadableMath,
    normalizeReadWeaveTermIdentityForReview,
    READWEAVE_CANDIDATE_LIMIT,
    READWEAVE_CANDIDATE_MIN_CONFIDENCE,
    readWeaveCompactStatusText,
    readWeaveGenerationProgressForDisplay,
    readWeaveGenerationVisualState,
    recoverReadWeaveGenerationFields,
    upsertReadWeaveGenerationJob,
    visibleReadWeaveCandidates
} from "./readweave_panel_state.js";

function generationJob(overrides: Partial<ReadWeaveGenerationJob> = {}): ReadWeaveGenerationJob {
    return {
        jobId: "job-1",
        articleId: "article-1",
        anchorId: "anchor-1",
        anchorType: "range",
        kind: "question",
        title: "问题",
        sourceExcerpt: "锚点",
        status: "complete",
        unread: false,
        progress: [],
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:01.000Z",
        ...overrides
    };
}

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

    it("keeps exact-range emphasis only while a status indicator is present", () => {
        expect(readWeaveGenerationVisualState({ status: "queued", unread: false })).toBe("running");
        expect(readWeaveGenerationVisualState({ status: "running", unread: false })).toBe("running");
        expect(readWeaveGenerationVisualState({ status: "failed", unread: false })).toBe("error");
        expect(readWeaveGenerationVisualState({ status: "complete", unread: true })).toBe("unread");
        expect(readWeaveGenerationVisualState({ status: "complete", unread: false })).toBeUndefined();
    });

    it("removes terminal sentence punctuation from compact status and log rows", () => {
        expect(readWeaveCompactStatusText("已使用上下文 4488 个字符。  ")).toBe("已使用上下文 4488 个字符");
        expect(readWeaveCompactStatusText("No fallback answer was used.")).toBe("No fallback answer was used");
        expect(readWeaveCompactStatusText("联网失败（timeout.）")).toBe("联网失败（timeout）");
        expect(readWeaveCompactStatusText("模型返回“failed.”")).toBe("模型返回“failed”");
        expect(readWeaveCompactStatusText("正在生成……")).toBe("正在生成……");
    });

    it("normalizes legacy math for display without touching LaTeX, URLs or inline code", () => {
        const input = "1 nm = 10^-9 m；16×10^-9 m；x>=3；已有 $C_{pk}$；https://example.test/10^9；`x>=3`";
        const expected = "1 nm = $10^{-9}$ m；$16 \\times 10^{-9}$ m；$x \\geq 3$；已有 $C_{pk}$；https://example.test/10^9；`x>=3`";
        expect(normalizeReadWeaveReadableMath(input)).toBe(expected);
        expect(normalizeReadWeaveReadableMath(expected)).toBe(expected);
    });

    it("leaves block formulas, prices, prose identifiers and incomplete math delimiters intact", () => {
        const input = "块公式 $$E = mc^2$$；价格 $5；型号 x86；版本 v1.2.3；文件 A_B；普通句子";
        expect(normalizeReadWeaveReadableMath(input)).toBe(input);
    });

    it("does not let an older asynchronous response replace a newer running job", () => {
        const running = generationJob({
            status: "running",
            updatedAt: "2026-07-22T00:00:03.000Z"
        });
        const delayedViewedResponse = generationJob({
            status: "complete",
            unread: false,
            updatedAt: "2026-07-22T00:00:02.000Z"
        });

        expect(upsertReadWeaveGenerationJob([ running ], delayedViewedResponse)).toEqual([ running ]);
        expect(mergeReadWeaveGenerationJobSnapshot([ running ], [ delayedViewedResponse ])).toEqual([ running ]);
    });

    it("accepts a newer server state after an optimistic queued job", () => {
        const queued = generationJob({
            status: "queued",
            updatedAt: "2026-07-22T00:00:02.000Z"
        });
        const complete = generationJob({
            status: "complete",
            unread: true,
            updatedAt: "2026-07-22T00:00:03.000Z"
        });

        expect(upsertReadWeaveGenerationJob([ queued ], complete)).toEqual([ complete ]);
        expect(mergeReadWeaveGenerationJobSnapshot([ queued ], [ complete ])).toEqual([ complete ]);
    });

    it("creates one foldable failed log row when an old failed job has no progress", () => {
        const job = generationJob({
            status: "failed",
            progress: [],
            createdAt: "2026-07-22T00:00:00.000Z",
            updatedAt: "2026-07-22T00:00:03.000Z"
        });

        expect(readWeaveGenerationProgressForDisplay(job, "生成失败。")).toEqual([ {
            sequence: 0,
            timestamp: "2026-07-22T00:00:03.000Z",
            elapsedMs: 3_000,
            stage: "failed",
            round: 0,
            message: "生成失败。",
            issues: []
        } ]);
        expect(readWeaveGenerationProgressForDisplay(generationJob({ status: "complete" }), "生成失败。")).toEqual([]);
    });

    it("restores a completed background term identity over its stale session snapshot", () => {
        const restored = recoverReadWeaveGenerationFields({
            draft: {
                body: "",
                bodyEdited: false,
                termIdentity: { abbreviation: "BS-PDN-Last", chineseName: "用户校正名称" }
            },
            job: {
                status: "complete",
                title: "BS-PDN-Last",
                result: {
                    body: "BS-PDN-Last 是一种面向背面供电网络的设计方法",
                    optimizedTitle: "背面供电网络设计方法",
                    termIdentity: {
                        abbreviation: "BS-PDN-Last",
                        chineseName: "背面供电网络设计方法",
                        englishName: "Backside Power Delivery Network Last"
                    },
                    context: { fragmentIds: [], characterCount: 0, characterBudget: 0, expansionLevel: 0, attemptedBudgets: [] },
                    workflow: { generationAttempts: 1, validationPasses: 1, contextExpansions: 0, repairRounds: 0, unchangedSegmentsVerified: true },
                    provider: "test",
                    model: "test",
                    reviewIssues: []
                }
            }
        });

        expect(restored.body).toBe("BS-PDN-Last 是一种面向背面供电网络的设计方法");
        expect(restored.termIdentity).toEqual({
            abbreviation: "BS-PDN-Last",
            chineseName: "背面供电网络设计方法",
            englishName: "Backside Power Delivery Network Last"
        });
        expect(restored.termIdentityEdited).toBe(false);
        expect(restored.questionTitle).toBe("背面供电网络设计方法");
        expect(isReadWeaveReviewSaveAllowed({
            reviewIssues: [],
            body: restored.body,
            kind: "term",
            termIdentity: restored.termIdentity
        })).toBe(true);
    });

    it("preserves an explicitly edited term identity when returning to a completed job", () => {
        const restored = recoverReadWeaveGenerationFields({
            draft: {
                termIdentity: { abbreviation: "ACM", chineseName: "用户审核后的名称" },
                termIdentityEdited: true
            },
            job: {
                status: "complete",
                title: "ACM",
                result: {
                    body: "ACM 是计算机领域的专业组织",
                    termIdentity: {
                        abbreviation: "ACM",
                        chineseName: "美国计算机协会",
                        englishName: "Association for Computing Machinery"
                    },
                    context: { fragmentIds: [], characterCount: 0, characterBudget: 0, expansionLevel: 0, attemptedBudgets: [] },
                    workflow: { generationAttempts: 1, validationPasses: 1, contextExpansions: 0, repairRounds: 0, unchangedSegmentsVerified: true },
                    provider: "test",
                    model: "test",
                    reviewIssues: []
                }
            }
        });

        expect(restored.termIdentity).toEqual({
            abbreviation: "ACM",
            chineseName: "用户审核后的名称",
            englishName: "Association for Computing Machinery"
        });
        expect(restored.termIdentityEdited).toBe(true);
    });

    it("keeps an explicitly edited answer when returning to a completed job", () => {
        const restored = recoverReadWeaveGenerationFields({
            draft: { body: "用户审核后的定义", bodyEdited: true },
            job: {
                status: "complete",
                title: "术语",
                result: {
                    body: "后台生成定义",
                    context: { fragmentIds: [], characterCount: 0, characterBudget: 0, expansionLevel: 0, attemptedBudgets: [] },
                    workflow: { generationAttempts: 1, validationPasses: 1, contextExpansions: 0, repairRounds: 0, unchangedSegmentsVerified: true },
                    provider: "test",
                    model: "test",
                    reviewIssues: []
                }
            }
        });

        expect(restored.body).toBe("用户审核后的定义");
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

    it("blocks an untouched draft that failed automatic review", () => {
        const baseline = createReadWeaveReviewIssueBaseline("NPU 是一种处理器。", {
            abbreviation: "NPU",
            chineseName: "神经网络处理单元",
            englishName: "Neural Processing Unit"
        });

        expect(isReadWeaveReviewSaveAllowed({
            reviewIssues: [ "定义过于宽泛" ],
            baseline,
            body: "  NPU 是一种处理器。  ",
            kind: "term",
            termIdentity: {
                abbreviation: "NPU",
                chineseName: "神经网络处理单元",
                englishName: "Neural   Processing Unit"
            }
        })).toBe(false);
        expect(isReadWeaveReviewSaveAllowed({
            reviewIssues: [ "定义过于宽泛" ],
            body: "NPU 是一种处理器。",
            kind: "term"
        })).toBe(false);
        expect(isReadWeaveReviewSaveAllowed({
            reviewIssues: [ "定义过于宽泛" ],
            baseline: { body: undefined as unknown as string },
            body: "NPU 是一种处理器。",
            kind: "term"
        })).toBe(false);
    });

    it("allows a failed-review draft to reach the server gate only after a meaningful edit", () => {
        const baseline = createReadWeaveReviewIssueBaseline("NPU 是一种处理器。", {
            abbreviation: "NPU",
            chineseName: "神经网络处理单元",
            englishName: "Neural Processing Unit"
        });
        const common = {
            reviewIssues: [ "定义过于宽泛" ],
            baseline,
            kind: "term" as const
        };

        expect(isReadWeaveReviewSaveAllowed({
            ...common,
            body: "NPU 是面向神经网络张量运算的专用处理器。",
            termIdentity: baseline.termIdentity
        })).toBe(true);
        expect(isReadWeaveReviewSaveAllowed({
            ...common,
            body: baseline.body,
            termIdentity: { ...baseline.termIdentity, chineseName: "神经处理单元" }
        })).toBe(true);
        expect(isReadWeaveReviewSaveAllowed({
            ...common,
            body: baseline.body,
            termIdentity: baseline.termIdentity
        })).toBe(false);
    });

    it("does not gate drafts that passed automatic review", () => {
        expect(isReadWeaveReviewSaveAllowed({
            reviewIssues: [],
            body: "回答正文",
            kind: "question"
        })).toBe(true);
    });
});
