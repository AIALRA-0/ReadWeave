import { describe, expect, it } from "vitest";

import { buildReadWeaveDomainProfile } from "./readweave_domain_policy.js";
import {
    isReadWeavePersonProfileQuery,
    readWeavePersonSubject
} from "./readweave_question_intent.js";

const academicArticle = [
    "论文作者：Lingjun Zhu、Jiawei Hu、Gauthaman Murali、Sung Kyu Lim",
    "David Z. Pan 是电子设计自动化领域的教授和研究者",
    "Hetero-3D 把异构三维芯片的逻辑层和存储层连接起来",
    "标准单元、SRAM、面对面混合键合、GDSII 和解析布局都是正文中的技术对象"
].join("\n");

const technicalQuestions = [
    "“异构”是什么？",
    "“标准单元”是什么？",
    "“SRAM 静态随机存取存储器（Static Random-Access Memory）”是什么？",
    "“面对面混合键合”是什么？",
    "“GDSII 图形设计系统二代格式（Graphic Design System II）”为什么叫第二代？",
    "“解析布局”如何运作？",
    "“Cortex-A53”是什么？",
    "“非对称楼层规划”有什么作用？",
    "“去耦电容”为什么能改善供电？",
    "“电源分配网络”是什么？",
    "“全局布局”与详细布局有什么区别？",
    "“高斯过程回归”怎样预测电压下降？",
    "“拉格朗日函数”在这里处理什么约束？",
    "“有限内存拟牛顿算法”是什么？",
    "“混合键合”当前有哪些工艺限制？",
    "“身份验证”是什么？",
    "“数字身份”如何运作？",
    "“人物识别算法”是什么？",
    "“人工智能”的研究方向有哪些？",
    "“高斯过程”的研究方向有哪些？",
    "“技术背景”是什么意思？"
];

describe("ReadWeave person-intent isolation", () => {
    it.each(technicalQuestions)(
        "does not turn a technical object into a person: %s",
        (question) => {
            expect(
                readWeavePersonSubject(question, academicArticle)
            ).toBeUndefined();
            const profile = buildReadWeaveDomainProfile(
                { kind: "question", title: question },
                question,
                academicArticle
            );
            expect(profile.domains).not.toContain("identity");
            expect(profile.requiredEvidenceTypes).not.toContain("current-role");
        }
    );

    it.each([
        [ "“Wuxi Li”是谁？", "Wuxi Li" ],
        [ "wuxili 是谁？", "wuxili" ],
        [ "“任浩星”现任什么职位？", "任浩星" ],
        [ "“David Z. Pan”的个人简介", "David Z. Pan" ],
        [ "Sung Kyu Lim 的研究方向是什么？", "Sung Kyu Lim" ],
        [ "周志华的职业背景是什么？", "周志华" ],
        [ "谁是 Grace Hopper？", "Grace Hopper" ],
        [ "谁是周志华？", "周志华" ],
        [ "Who is Fei-Fei Li?", "Fei-Fei Li" ]
    ])("keeps explicit person intent: %s", (question, subject) => {
        expect(readWeavePersonSubject(question, academicArticle)).toBe(subject);
        expect(
            buildReadWeaveDomainProfile(
                { kind: "question", title: question },
                question,
                academicArticle
            ).domains
        ).toContain("identity");
    });

    it("allows the Definition action on a directly identified person without using unrelated article-wide cues", () => {
        expect(
            readWeavePersonSubject(
                "“Sung Kyu Lim”是什么？",
                "Sung Kyu Lim 是电子设计自动化领域的教授和研究者"
            )
        ).toBe("Sung Kyu Lim");
        expect(
            readWeavePersonSubject("“标准单元”是什么？", academicArticle)
        ).toBeUndefined();
    });

    it("recognizes and removes only the retired synthetic profile-query shapes", () => {
        expect(
            isReadWeavePersonProfileQuery(
                "标准单元 官方主页 大学 教授 研究方向"
            )
        ).toBe(true);
        expect(
            isReadWeavePersonProfileQuery(
                '"标准单元" official profile research interests research areas'
            )
        ).toBe(true);
        expect(
            isReadWeavePersonProfileQuery(
                "标准单元 standard cell 官方定义与物理设计用途"
            )
        ).toBe(false);
    });
});
