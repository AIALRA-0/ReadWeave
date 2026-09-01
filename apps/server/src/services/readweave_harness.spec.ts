import { beforeAll, describe, expect, it, vi } from "vitest";

const answers = vi.hoisted(() => new Map<string, string>());
const blockers = vi.hoisted(() => new Map<string, Promise<void>>());

vi.mock("./readweave_unified_ai.js", () => ({
    generateUnifiedReadWeaveAnswer: vi.fn(async (request: { anchorId: string }) => {
        await blockers.get(request.anchorId);
        return {
            body: answers.get(request.anchorId) ?? "缺少案例答案",
            qualityState: "verified",
            evidenceState: "externally-checked",
            harnessVersion: "test",
            unresolvedIssues: [],
            reviewIssues: undefined
        };
    })
}));

import type { ReadWeaveHarnessTrialJob } from "@triliumnext/commons";

import {
    addReadWeaveHarnessCase,
    archiveReadWeaveHarnessProfile,
    createReadWeaveHarnessDraft,
    getPublishedReadWeaveHarnessProfile,
    getReadWeaveHarnessProfile,
    getReadWeaveHarnessTrialJob,
    initializeReadWeaveHarnessTrials,
    publishReadWeaveHarnessProfile,
    rollbackReadWeaveHarnessProfile,
    trialReadWeaveHarnessProfile,
    updateReadWeaveHarnessDraft
} from "./readweave_harness.js";
import {
    READWEAVE_HOLDOUT_QUALITY_CASES,
    READWEAVE_VISIBLE_QUALITY_CASES
} from "./readweave_quality_cases.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";

function passingAnswer(testCase: (typeof READWEAVE_VISIBLE_QUALITY_CASES)[number]): string {
    const facts = testCase.expectedFacts.join("；");
    const intent = testCase.expectedIntent
        ?? (/(?:是谁|是何人)/u.test(testCase.question) ? "identity"
            : /(?:形态|形式)/u.test(testCase.question) ? "form"
                : /(?:如何|怎么|工作原理)/u.test(testCase.question) ? "mechanism"
                    : /(?:为什么|为何)/u.test(testCase.question) ? "reason"
                        : /(?:区别|差异|比较|分别)/u.test(testCase.question) ? "comparison"
                            : /(?:多少|计算|相差)/u.test(testCase.question) ? "calculation"
                                : /(?:能否|是否|限制)/u.test(testCase.question) ? "boundary"
                                    : "definition");
    if (intent === "identity") return `该人物是相关领域的研究者；${facts}`;
    if (intent === "form") return `该对象以逻辑协议或结构载体存在；${facts}`;
    if (intent === "mechanism") return `系统先接收输入；随后通过关键过程完成转换；最后输出结果；${facts}`;
    if (intent === "reason") return `因为${facts}；这些因素会导致所问结果，因此需要按因果链判断`;
    if (intent === "comparison") return `${facts}；两者在这些维度上分别承担不同职责`;
    if (intent === "calculation") return `${facts}；计算结果为 1`;
    if (intent === "boundary") return `不能把结论无条件扩大；是否成立取决于具体条件；${facts}`;
    return `该对象是问题所指的通用概念；${facts}`;
}

async function waitForTrial(job: ReadWeaveHarnessTrialJob): Promise<ReadWeaveHarnessTrialJob> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const current = getReadWeaveHarnessTrialJob(job.trialJobId);
        if (current.status === "passed" || current.status === "failed") return current;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Harness trial timed out");
}

async function runTrial(versionId: string): Promise<ReadWeaveHarnessTrialJob> {
    return waitForTrial(trialReadWeaveHarnessProfile(versionId, {}));
}

describe("ReadWeave Harness lifecycle", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        for (const testCase of [ ...READWEAVE_VISIBLE_QUALITY_CASES, ...READWEAVE_HOLDOUT_QUALITY_CASES ]) {
            answers.set(testCase.caseId, passingAnswer(testCase));
        }
    });

    it("seeds the current 76-question baseline instead of an equal-sized legacy template set", () => {
        const published = getPublishedReadWeaveHarnessProfile();
        expect(published.versionId).toBe("quality-closure-v2.2.0");
        expect(published.cases).toHaveLength(152);
        const semanticQuestions = new Set(published.cases.map(testCase => testCase.question.replace(/^请直接说明：/u, "")));
        expect(semanticQuestions.size).toBe(76);
    });

    it("requires all visible and holdout cases before publication", async () => {
        const draft = createReadWeaveHarnessDraft({ name: "Harness lifecycle test" });
        expect(draft.cases).toHaveLength(152);
        expect(() => publishReadWeaveHarnessProfile(draft.versionId, {})).toThrow("只有已经通过试跑");

        const trial = await runTrial(draft.versionId);
        expect(trial).toMatchObject({
            status: "passed",
            completedCases: 202,
            totalCases: 202,
            result: {
                passed: true,
                passedCases: 202,
                visibleCases: 152,
                hiddenCases: 50,
                hiddenFailedCases: 0,
                failedCases: []
            }
        });

        updateReadWeaveHarnessDraft(draft.versionId, {
            modules: { ...draft.modules, answerWriting: `${draft.modules.answerWriting}\n先给直接结论` }
        });
        expect(() => publishReadWeaveHarnessProfile(draft.versionId, {
            trialJobId: trial.trialJobId,
            revisionId: trial.revisionId,
            contentDigest: trial.contentDigest
        })).toThrow("只有已经通过试跑");

        const retrial = await runTrial(draft.versionId);
        expect(retrial.status).toBe("passed");
        expect(publishReadWeaveHarnessProfile(draft.versionId, {
            trialJobId: retrial.trialJobId,
            revisionId: retrial.revisionId,
            contentDigest: retrial.contentDigest
        }).status).toBe("published");
    });

    it("adds a human-corrected case and rejects the marked bad answer", async () => {
        const draft = createReadWeaveHarnessDraft({ name: "Human correction test" });
        const updated = addReadWeaveHarnessCase(draft.versionId, {
            question: "CXL.io 具体是什么形态？",
            category: "用户反馈",
            expectedIntent: "form",
            badAnswer: "CXL.io 负责初始化设备",
            referenceAnswer: "CXL.io 是一组逻辑协议事务与处理规则",
            expectedFacts: [ "逻辑协议" ],
            forbiddenClaims: [],
            critical: true
        });
        const added = updated.cases.at(-1)!;
        expect(() => trialReadWeaveHarnessProfile(updated.versionId, {
            answers: [ { caseId: added.caseId, answer: added.badAnswer } ]
        })).toThrow("不接受调用方提供答案");
        answers.set(added.caseId, added.badAnswer!);
        const trial = await runTrial(updated.versionId);
        expect(trial.result?.failedCases).toContainEqual(expect.objectContaining({
            caseId: added.caseId,
            issues: expect.arrayContaining([ "答案与已标注错误答案相同", "没有直接说明对象形态或载体" ])
        }));
    });

    it("binds a running trial to its original immutable revision", async () => {
        const draft = createReadWeaveHarnessDraft({ name: "Immutable running trial" });
        const blockedCaseId = draft.cases[0].caseId;
        let release!: () => void;
        blockers.set(blockedCaseId, new Promise<void>(resolve => { release = resolve; }));
        const trial = trialReadWeaveHarnessProfile(draft.versionId, {});
        for (let attempt = 0; attempt < 100 && getReadWeaveHarnessTrialJob(trial.trialJobId).status !== "running"; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        const changed = updateReadWeaveHarnessDraft(draft.versionId, {
            modules: { ...draft.modules, answerWriting: `${draft.modules.answerWriting}\n试跑期间的新改动` }
        });
        expect(changed.currentRevisionId).not.toBe(trial.revisionId);
        release();
        blockers.delete(blockedCaseId);
        const completed = await waitForTrial(trial);
        expect(completed.status).toBe("passed");
        expect(getReadWeaveHarnessProfile(draft.versionId).status).toBe("draft");
        expect(() => publishReadWeaveHarnessProfile(draft.versionId, {
            trialJobId: completed.trialJobId,
            revisionId: completed.revisionId,
            contentDigest: completed.contentDigest
        })).toThrow();
    });

    it("resumes a persisted running trial through the startup initializer", async () => {
        const draft = createReadWeaveHarnessDraft({ name: "Restart trial" });
        const trialJobId = "trial-restart-test";
        const timestamp = new Date().toISOString();
        sql.execute(/* sql */`
            INSERT INTO readweave_harness_trial_jobs (
                trialJobId, versionId, revisionId, contentDigest, status,
                completedCases, totalCases, resultJson, error, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, 'running', 17, ?, NULL, NULL, ?, ?)
        `, [ trialJobId, draft.versionId, draft.currentRevisionId, draft.contentDigest, draft.cases.length + 50, timestamp, timestamp ]);

        initializeReadWeaveHarnessTrials();
        const completed = await waitForTrial(getReadWeaveHarnessTrialJob(trialJobId));
        expect(completed.status).toBe("passed");
        expect(completed.completedCases).toBe(completed.totalCases);
    });

    it("blocks publication without exposing hidden questions or expected facts", async () => {
        const hidden = READWEAVE_HOLDOUT_QUALITY_CASES[0];
        const original = answers.get(hidden.caseId)!;
        answers.set(hidden.caseId, "错误答案");
        try {
            const draft = createReadWeaveHarnessDraft({ name: "Hidden gate test" });
            const trial = await runTrial(draft.versionId);
            const result = trial.result!;
            expect(trial.status).toBe("failed");
            expect(result.passed).toBe(false);
            expect(result.hiddenFailedCases).toBe(1);
            expect(result.failedCases.some(item => item.caseId.startsWith("holdout-"))).toBe(false);
            expect(JSON.stringify(result)).not.toContain(hidden.question);
            for (const fact of hidden.expectedFacts) expect(JSON.stringify(result)).not.toContain(fact);
        } finally {
            answers.set(hidden.caseId, original);
        }
    });

    it("supports copy, archive and rollback without mutating the published source", async () => {
        const published = getPublishedReadWeaveHarnessProfile();
        const first = createReadWeaveHarnessDraft({ sourceVersionId: published.versionId, name: "First published test" });
        const firstTrial = await runTrial(first.versionId);
        expect(publishReadWeaveHarnessProfile(first.versionId, {
            trialJobId: firstTrial.trialJobId,
            revisionId: firstTrial.revisionId,
            contentDigest: firstTrial.contentDigest
        }).status).toBe("published");
        const second = createReadWeaveHarnessDraft({ sourceVersionId: first.versionId, name: "Second published test" });
        const secondTrial = await runTrial(second.versionId);
        publishReadWeaveHarnessProfile(second.versionId, {
            trialJobId: secondTrial.trialJobId,
            revisionId: secondTrial.revisionId,
            contentDigest: secondTrial.contentDigest
        });
        expect(rollbackReadWeaveHarnessProfile(first.versionId).status).toBe("published");
        expect(getPublishedReadWeaveHarnessProfile().versionId).toBe(first.versionId);
        const disposable = createReadWeaveHarnessDraft({ sourceVersionId: first.versionId, name: "Archive test" });
        expect(disposable.parentVersionId).toBe(first.versionId);
        expect(archiveReadWeaveHarnessProfile(disposable.versionId).status).toBe("archived");
    });
});
