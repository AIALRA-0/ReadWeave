import { describe, expect, it } from "vitest";

import {
    READWEAVE_HOLDOUT_QUALITY_CASES,
    READWEAVE_VISIBLE_QUALITY_CASES
} from "./readweave_quality_cases.js";

describe("ReadWeave quality corpus", () => {
    it("contains at least 200 cases with 50 server-only holdout cases", () => {
        expect(READWEAVE_VISIBLE_QUALITY_CASES).toHaveLength(152);
        expect(READWEAVE_HOLDOUT_QUALITY_CASES).toHaveLength(50);
        expect(new Set([
            ...READWEAVE_VISIBLE_QUALITY_CASES,
            ...READWEAVE_HOLDOUT_QUALITY_CASES
        ].map(testCase => testCase.caseId)).size).toBe(202);
    });

    it("covers every required subject family with explicit acceptance criteria", () => {
        const allCases = [ ...READWEAVE_VISIBLE_QUALITY_CASES, ...READWEAVE_HOLDOUT_QUALITY_CASES ];
        const categories = new Set(allCases.map(testCase => testCase.category));

        for (const category of [ "人物", "缩写", "协议", "数学", "医学", "法律", "历史", "工程", "长文理解", "跨语言" ]) {
            expect(categories.has(category)).toBe(true);
        }
        expect(allCases.every(testCase => testCase.critical && testCase.expectedFacts.length > 0)).toBe(true);
        expect(allCases.every(testCase => testCase.question.endsWith("？"))).toBe(true);
    });

    it("does not expose holdout cases through the visible collection", () => {
        expect(READWEAVE_VISIBLE_QUALITY_CASES.some(testCase => testCase.caseId.startsWith("holdout-"))).toBe(false);
        expect(READWEAVE_HOLDOUT_QUALITY_CASES.every(testCase => testCase.caseId.startsWith("holdout-"))).toBe(true);
    });

    it("uses 101 distinct questions instead of inflating the corpus with five template suffixes", () => {
        const semanticQuestion = (question: string) => question
            .replace(/^请直接说明：|^请用通俗语言回答：/u, "")
            .replace(/[？?]+$/u, "");

        expect(new Set(READWEAVE_VISIBLE_QUALITY_CASES.map(testCase => semanticQuestion(testCase.question))).size).toBe(76);
        expect(new Set(READWEAVE_HOLDOUT_QUALITY_CASES.map(testCase => semanticQuestion(testCase.question))).size).toBe(25);
    });
});
