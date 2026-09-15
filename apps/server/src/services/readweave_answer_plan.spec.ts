import { describe, expect, it } from "vitest";
import type { ReadWeaveQuestionContract, ReadWeaveTaskContract } from "@triliumnext/commons";

import { buildReadWeaveAnswerPlan } from "./readweave_answer_plan.js";
import { captureReadWeaveTask, readWeaveTaskContractIssues } from "./readweave_task_contract.js";

describe("ReadWeave answer plan", () => {
    const namingContract = (normalizedQuestion: string) => ({
        normalizedQuestion,
        objective: "回答用户指定维度",
        answerRequirements: [],
        exclusions: [],
        searchQueries: [],
        requiresCurrentEvidence: true
    });
    it("keeps summary output in a factual list instead of adding background", () => {
        const plan = buildReadWeaveAnswerPlan(
            namingContract("总结选区，保留数值和否定"),true,"key-point");
        expect(plan.answerRequirements).toEqual(plan.steps);
        expect(plan.steps.join(" ")).toContain("输出列表");
        expect(plan.steps.join(" ")).not.toContain("解释必要背景");
    });
    it("does not turn a full-name and word-meaning question into a complete definition", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("XPT 的官方全称是什么？解释这些词分别表示什么，不要猜测名称来历"));
        expect(plan.answerType).toBe("general");
        expect(plan.steps).toEqual([ "给出有来源支持的正式全称", "逐项解释全称中各词的含义，不扩展其他术语或机制" ]);
    });
    it("keeps a full-name-only flow short", () => {
        expect(buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？")).steps).toHaveLength(1);
    });
    it("keeps origin answers narrow and honors negative scope", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("Lumen 的名称来源是什么？只解释得名原因，不介绍语法和用途"));
        expect(plan.answerType).toBe("general");
        expect(plan.steps).toHaveLength(1);
        expect(plan.answerRequirements).toEqual(plan.steps);
        expect(plan.exclusions).toContain("不介绍语法和用途");
    });
    it("does not erase explicitly requested history from a broader naming question", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract(
            "Lumen 的名称来源是什么？它的发展历史和用途是什么？"
        ));
        expect(plan.steps.length).toBeGreaterThan(1);
    });
    it("answers both the full name and origin when both are explicitly requested", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("Lumen 的全称和名称来源是什么？"));
        expect(plan.steps).toHaveLength(2);
        expect(plan.steps[0]).toContain("正式全称");
        expect(plan.steps[1]).toContain("名称从何而来");
    });
    it("retains broader steps when the user actually requests a mechanism", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？它的运作原理是什么？"));
        expect(plan.answerType).toBe("definition");
    });
    it("builds a compact definition flow from an unrelated software question", () => {
        const plan = buildReadWeaveAnswerPlan({
            normalizedQuestion: "容器编排是什么？",
            objective: "解释容器编排的基本含义",
            answerRequirements: [ "给出定义" ],
            exclusions: [ "不展开产品历史" ],
            searchQueries: [ "容器编排 定义" ],
            requiresCurrentEvidence: false
        });

        expect(plan.answerType).toBe("definition");
        expect(plan.summary).toBe("定义对象 → 说明主要处理什么 → 说明如何运作 → 说明最终作用 → 补一个边界");
        expect(plan.autoApplied).toBe(true);
    });

    it("keeps a calculation question separate from a definition flow", () => {
        const plan = buildReadWeaveAnswerPlan({
            normalizedQuestion: "收益率曲线倒挂的差值如何计算？",
            objective: "说明计算方式",
            answerRequirements: [ "给出公式" ],
            exclusions: [],
            searchQueries: [],
            requiresCurrentEvidence: false
        }, false);

        expect(plan.answerType).toBe("calculation");
        expect(plan.autoApplied).toBe(false);
        expect(plan.steps).toEqual([ "列出已知量", "明确计算方向", "给出公式或步骤", "核对结果和单位" ]);
    });

    describe("validated task contracts", () => {
        type Proposal = ReadWeaveTaskContract["interpretation"]["proposal"];
        const task = (id: string, instruction: string, expectedDeliverable = instruction): Proposal["tasks"][number] => ({
            id, instruction, expectedDeliverable,
            intentHints: [], subjectIds: [], requirementIds: [ "root" ],
            originRefs: [ { blockId: "question", locator: { kind: "whole" } } ],
            dependsOnTaskIds: [], acceptanceCriteria: [], scope: "用户指定范围"
        });
        const questionContract = (
            root: string,
            proposal: Proposal,
            status: ReadWeaveTaskContract["interpretation"]["status"] = "accepted"
        ): ReadWeaveQuestionContract => {
            const taskContract = captureReadWeaveTask({
                articleId: "article", anchorId: "anchor", anchorType: "range",
                kind: "question", title: root, fragments: []
            }, true);
            taskContract.interpretation = {
                status, proposal,
                producer: status === "fallback" ? "deterministic_fallback" : "existing_call",
                diagnostics: []
            };
            expect(readWeaveTaskContractIssues(taskContract)).toEqual([]);
            return { ...namingContract(root), taskContract };
        };

        it.each([
            { kindHints: [] },
            { kindHints: [ "unseen-kind" ] },
            { kindHints: [ "person", "protocol", "new-kind" ] }
        ])(
            "uses open task semantics with kindHints $kindHints", ({ kindHints }) => {
                const plan = buildReadWeaveAnswerPlan(questionContract("Echo 是谁？它的协议有什么区别？", {
                    subjects: [ {
                        id: "echo", surface: "Echo", kindHints,
                        mentions: [ { blockId: "question", locator: { kind: "whole" } } ],
                        interpretation: "上下文中的对象", aliases: [], role: "target", introducedByTaskId: null
                    } ],
                    tasks: [ {
                        ...task("explain", "说明对象和协议的关系", "按选区解释对象与协议的关系"),
                        subjectIds: [ "echo" ], intentHints: [ "identity", "comparison", "novel-intent" ]
                    } ]
                }));
                expect(plan.answerType).toBe("general");
                expect(plan.steps).toEqual([ "按选区解释对象与协议的关系" ]);
            }
        );

        it("follows proposed task order and preserves compound tasks omitted from that order", () => {
            const contract = questionContract("说明作者是谁，比较两种方法，再计算差值", {
                tasks: [
                    task("compare", "比较两种方法", "列出两种方法的实测差异"),
                    task("identify", "说明作者是谁", "说明作者与文章的关系"),
                    task("calculate", "计算差值", "给出差值及单位")
                ],
                answerPlan: {
                    objective: "解释作者、方法差异和数值结果", requiredPoints: [ "保留测量条件" ],
                    exclusions: [], orderedTaskIds: [ "identify", "compare" ], contextUse: "使用文章中的测量结果"
                }
            });
            const before = structuredClone(contract);
            const plan = buildReadWeaveAnswerPlan(contract, false);
            expect(plan.steps).toEqual([ "说明作者与文章的关系", "列出两种方法的实测差异", "给出差值及单位" ]);
            expect(plan.summary).toBe(plan.steps.join(" → "));
            expect(plan.objective).toBe("解释作者、方法差异和数值结果");
            expect(plan.answerRequirements).toContain("保留测量条件");
            expect(plan.answerRequirements).toContain("比较两种方法");
            expect(plan.reviewStatus).toBe("draft");
            expect(plan.autoApplied).toBe(false);
            expect(contract).toEqual(before);
        });

        it("uses task instructions when a thin proposal has no deliverable or answer plan", () => {
            const root = "Mira 是谁？";
            const plan = buildReadWeaveAnswerPlan(questionContract(root, {
                tasks: [ task("root-answer", "直接回答问题", "") ]
            }, "fallback"));
            expect(plan.answerType).toBe("general");
            expect(plan.steps).toEqual([ "直接回答问题" ]);
            expect(plan.objective).toBe(root);
            expect(plan.answerRequirements).toContain(root);
            expect(plan.reviewStatus).toBe("auto-applied");
        });

        // Add steps only for additional task needs; hints and answer guidelines do not create tasks.
        it("keeps answer guidelines within one step until another task is needed", () => {
            const proposal: Proposal = {
                tasks: [ task("identify", "说明作者是谁", "直接说明作者身份") ],
                answerPlan: {
                    objective: "回答作者身份", requiredPoints: [ "使用直接来源", "保留必要限定" ],
                    exclusions: [ "不展开履历" ], orderedTaskIds: [ "identify" ], contextUse: "只使用必要上下文"
                }
            };
            const single = buildReadWeaveAnswerPlan(questionContract("作者是谁？", proposal));
            expect(single.steps).toEqual([ "直接说明作者身份" ]);
            expect(single.answerRequirements).toEqual(expect.arrayContaining([ "使用直接来源", "保留必要限定" ]));

            const multiple = buildReadWeaveAnswerPlan(questionContract("作者是谁？再比较两种方法", {
                ...proposal, tasks: [ ...proposal.tasks, task("compare", "比较两种方法", "给出方法差异") ]
            }));
            expect(multiple.steps).toEqual([ "直接说明作者身份", "给出方法差异" ]);
        });

        it("retains the full root and mandatory requirements when a proposal covers only one part", () => {
            const root = "解释名称来源和运作方式，并计算输入输出的差值";
            const plan = buildReadWeaveAnswerPlan(questionContract(root, {
                tasks: [ task("name", "解释名称来源") ],
                requirements: [ {
                    id: "units", instruction: "计算时保留单位", mustAddress: true,
                    originRefs: [ { blockId: "question", locator: { kind: "whole" } } ]
                } ],
                answerPlan: {
                    objective: "解释名称", requiredPoints: [ "只提出了名称这一项" ], exclusions: [],
                    orderedTaskIds: [ "name" ], contextUse: ""
                }
            }));
            expect(plan.steps).toEqual([ "解释名称来源" ]);
            expect(plan.answerRequirements).toContain(root);
            expect(plan.answerRequirements).toContain("计算时保留单位");
        });

        it("preserves original exclusions even when normalization and the proposal omit them", () => {
            const root = "解释方法，不介绍人物履历，不展开历史";
            const contract = questionContract(root, {
                tasks: [ task("explain", "解释方法") ],
                answerPlan: {
                    objective: "解释方法", requiredPoints: [], orderedTaskIds: [ "explain" ],
                    exclusions: [ "不添加外部案例", "不展开历史" ], contextUse: ""
                }
            });
            contract.normalizedQuestion = "解释方法";
            contract.exclusions = [ "不展开历史", "不要猜测" ];
            const plan = buildReadWeaveAnswerPlan(contract);
            expect(plan.exclusions).toEqual([ "不介绍人物履历", "不展开历史", "不要猜测", "不添加外部案例" ]);
            expect(plan.answerRequirements).toContain(root);
        });

        it("honors the supplied task scope for naming and summary content", () => {
            const plan = buildReadWeaveAnswerPlan(questionContract("Lumen 的全称是什么？", {
                tasks: [ task("answer", "只给出文章使用的名称", "文章中的名称") ]
            }), true, "key-point");
            expect(plan.steps).toEqual([ "文章中的名称" ]);
            expect(plan.answerRequirements).toContain("只给出文章使用的名称");
        });

        it("keeps a direct answer and the root when there are no proposed tasks", () => {
            const root = "请解释这个陌生对象的关系";
            const plan = buildReadWeaveAnswerPlan(questionContract(root, { tasks: [] }, "not_needed"));
            expect(plan.steps).toEqual([ "直接回答问题" ]);
            expect(plan.answerRequirements).toContain(root);
        });
    });
});
