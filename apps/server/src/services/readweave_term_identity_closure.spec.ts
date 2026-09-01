import { describe, expect, it } from "vitest";

import {
    alignTermIdentityWithEvidencePlan,
    buildReadWeaveTaskProfile,
    canonicalizeRepeatedEnglishNames,
    contextGroundingRepairInstructions,
    findReadWeaveQualityIssues,
    formatReadWeaveTermIdentity,
    joinReadWeaveAnswerSegments,
    normalizeReadWeaveEvidencePlan,
    normalizeSegmentsForQuality,
    segmentReadWeaveAnswer
} from "./readweave_ai.js";

function resolvedPlan(
    entityType: "concept" | "organization" | "method",
    subject: string,
    sense: string
) {
    return normalizeReadWeaveEvidencePlan({
        requiredFacts: [ `${subject} 在当前片段中有明确语义` ],
        requiredClaims: [ `说明 ${subject} 的类别、角色与边界` ],
        evidenceBoundaries: [],
        ambiguities: [],
        canonicalEntityNeeds: [ `核验 ${subject} 的规范身份` ],
        entityType,
        resolvedSense: sense
    });
}

describe("ReadWeave canonical term identity closure", () => {
    it("never lets inferred evidence labels override a known canonical identity or contaminate later segments", () => {
        const canonical = "ASIC 专用集成电路（Application-Specific Integrated Circuit）";
        const normalized = canonicalizeRepeatedEnglishNames(
            segmentReadWeaveAnswer([
                "ASIC 的设计与制造周期“漫长且投入密集”（long and intensive），这只是证据中的描述。",
                "ASIC 专用芯片（Alternative Silicon Integrated Circuit）也出现在一条不可靠的证据标签中。",
                "ASIC 可以为固定工作负载定制数据路径和存储结构；ASIC 的代价是设计成本高且功能修改空间小。"
            ].join("\n\n")),
            "[selected:asic]\nASIC 是针对特定应用设计的集成电路。"
        );
        const body = joinReadWeaveAnswerSegments(normalized);
        const finalParagraph = body.split("\n\n").at(-1) ?? "";

        expect(finalParagraph).toContain(`${canonical}可以为固定工作负载定制数据路径和存储结构`);
        expect(finalParagraph).toContain(`${canonical}的代价是设计成本高且功能修改空间小`);
        expect(finalParagraph).not.toMatch(/long and intensive|Alternative Silicon Integrated Circuit/u);
        expect(body.match(/long and intensive/gu)).toHaveLength(1);
        expect(body.match(/Alternative Silicon Integrated Circuit/gu)).toHaveLength(1);
    });

    it.each([
        {
            subject: "ASIC",
            entityType: "concept" as const,
            generated: {
                chineseName: "专用集成电路",
                englishName: "ASIC"
            },
            expected: {
                abbreviation: "ASIC",
                chineseName: "专用集成电路",
                englishName: "Application-Specific Integrated Circuit"
            }
        },
        {
            subject: "EDA",
            entityType: "concept" as const,
            generated: {
                chineseName: "电子设计自动化",
                englishName: "EDA"
            },
            expected: {
                abbreviation: "EDA",
                chineseName: "电子设计自动化",
                englishName: "Electronic Design Automation"
            }
        },
        {
            subject: "IEEE",
            entityType: "organization" as const,
            generated: {
                abbreviation: "IEEE",
                chineseName: "电气与电子工程师学会",
                englishName: "Institute of Electrical and Electronics Engineers"
            },
            expected: {
                abbreviation: "IEEE",
                chineseName: "电气电子工程师学会",
                englishName: "Institute of Electrical and Electronics Engineers"
            }
        }
    ])("aligns $subject to its verified canonical identity before body review", ({
        subject,
        entityType,
        generated,
        expected
    }) => {
        const aligned = alignTermIdentityWithEvidencePlan(
            generated,
            undefined,
            buildReadWeaveTaskProfile("term", subject),
            resolvedPlan(entityType, subject, expected.chineseName)
        );

        expect(aligned).toEqual(expected);
        expect(formatReadWeaveTermIdentity(aligned ?? {}))
            .toBe(`${expected.abbreviation} ${expected.chineseName}（${expected.englishName}）`);
    });

    it("collapses the real duplicated ASIC opening to one canonical identity", () => {
        const profile = buildReadWeaveTaskProfile("term", "ASIC");
        const plan = resolvedPlan("concept", "ASIC", "针对特定应用设计的集成电路");
        const identity = alignTermIdentityWithEvidencePlan(
            {
                chineseName: "专用集成电路",
                englishName: "ASIC"
            },
            undefined,
            profile,
            plan
        );
        const body = joinReadWeaveAnswerSegments(normalizeSegmentsForQuality(
            segmentReadWeaveAnswer(
                "专用集成电路（ASIC） 专用集成电路（Application-Specific Integrated Circuit）是一种针对特定应用设计的集成电路，可为固定工作负载定制数据路径和存储结构；其边界是设计成本高且功能修改空间较小。"
            ),
            "[selected:selected]\nASIC 是针对特定应用设计的集成电路，可为固定工作负载定制数据路径和存储结构。",
            profile,
            identity,
            plan
        ));
        const canonical = "ASIC 专用集成电路（Application-Specific Integrated Circuit）";

        expect(body.startsWith(canonical)).toBe(true);
        expect(body.split(canonical)).toHaveLength(2);
        expect(body).not.toContain("专用集成电路（ASIC）");
        expect(findReadWeaveQualityIssues(body, profile.objective, {
            kind: "term",
            subject: "ASIC",
            termIdentity: identity
        })).toEqual([]);
    });

    it("does not accept a body and structured identity that agree with the same noncanonical IEEE translation", () => {
        const issues = findReadWeaveQualityIssues(
            "IEEE 电气与电子工程师学会（Institute of Electrical and Electronics Engineers）是制定技术规范并组织专业活动的工程组织。",
            "在当前语境中，IEEE 是什么？",
            {
                kind: "term",
                subject: "IEEE",
                termIdentity: {
                    abbreviation: "IEEE",
                    chineseName: "电气与电子工程师学会",
                    englishName: "Institute of Electrical and Electronics Engineers"
                }
            }
        );

        expect(issues).toContain("结构化名词身份与已核验规范名称不一致");
    });

    it("removes peripheral 3D IC and IR-drop wording from a DPO-3D definition instead of expanding it", () => {
        const repairs = contextGroundingRepairInstructions(
            [ {
                id: "seg-1",
                text: "面向三维集成电路的可微电源分配网络优化方法（DPO-3D）用于 3D IC 的 PDN 优化，并把 IR-drop 写入目标函数。"
            } ],
            [
                "[selected:selected]",
                "DPO-3D 是一种面向三维集成电路电源分配网络的可微优化方法，用于协同处理可布线性与电压降目标。",
                "",
                "[section:section]",
                "DPO-3D 是论文方法原名，不存在经公开来源确认的英文展开；PDN 表示电源分配网络。",
                "",
                "[web-evidence-plan:scope-controlled]",
                "{\"requiredFacts\":[\"外部资料使用 3D IC 与 IR-drop 表述\"]}"
            ].join("\n"),
            buildReadWeaveTaskProfile("term", "DPO-3D"),
            {
                chineseName: "面向三维集成电路的可微电源分配网络优化方法",
                englishName: "DPO-3D"
            }
        );

        expect(repairs).toHaveLength(1);
        expect(repairs[0].issue).toContain("3D");
        expect(repairs[0].issue).toContain("IC");
        expect(repairs[0].issue).toContain("IR-drop");
        expect(repairs[0].issue).not.toContain("DPO-3D、");
        expect(repairs[0].issue).not.toContain("PDN");
        expect(repairs[0].instruction).toMatch(/删除.*不得.*补写|猜测.*全称/u);
    });
});
