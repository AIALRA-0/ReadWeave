import { describe, expect, it } from "vitest";

import {
    alignTermIdentityWithEvidencePlan,
    buildDirectSelectedTermFallback,
    buildExplicitNonExpandableNameQuestionFallback,
    buildReadWeaveTaskProfile,
    contextGroundingRepairInstructions,
    deduplicateCanonicalNames,
    ensureReadWeaveDefinitionSubjectOpening,
    findReadWeaveQualityIssues,
    findReadWeaveTermDefinitionSemanticIssues,
    formatReadWeaveTermIdentity,
    isCurrentPersonProfileTask,
    isPublicReadWeaveSourceUrl,
    mergeReadWeaveTermIdentity,
    normalizeReadWeaveGeneratedBody,
    normalizeReadWeaveEvidencePlan,
    parseJsonObject,
    parseFormattedReadWeaveTermIdentity,
    pruneEvidencePlanForProfile,
    resolveVerifiedNonExpandableArtifact,
    validateReadWeaveTermIdentity
} from "./readweave_ai.js";

describe("ReadWeave final audit regressions", () => {
    it("uses a direct product-name answer when evidence says the uppercase name has no expansion", () => {
        const fallback = buildExplicitNonExpandableNameQuestionFallback(
            buildReadWeaveTaskProfile(
                "question",
                "Cloudflare WARP 在这里是什么，WARP 是否应被强行展开成英文缩写？"
            ),
            "[selected:selected]\nCloudflare WARP 是 Cloudflare 提供的网络连接产品名；官方将 WARP 作为产品名称使用，这段材料没有给出逐字母英文展开。"
        );
        expect(fallback).toBe(
            "网络连接产品（Cloudflare WARP）是 Cloudflare 提供的网络连接产品；该名称作为产品名称使用，没有经证实的逐字母英文展开"
        );
        expect(findReadWeaveQualityIssues(
            fallback ?? "",
            "Cloudflare WARP 在这里是什么，WARP 是否应被强行展开成英文缩写？",
            { kind: "question", knowledgeScope: "general" }
        )).toEqual([]);
    });

    it("collapses a model-repeated definition subject before applying the canonical opening", () => {
        expect(ensureReadWeaveDefinitionSubjectOpening(
            "电路划分是电路划分是把大型电路拆成较小部分并控制跨部分连接数量的方法",
            "电路划分",
            { chineseName: "电路划分" },
            "电路划分把规模较大的电路拆成若干较小部分"
        )).toBe("电路划分是把大型电路拆成较小部分并控制跨部分连接数量的方法");
    });

    it("preserves a legitimate lowercase English name inside a bilingual identity", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "计算机科学书目数据库（dblp computer science bibliography）帮助读者查找计算机科学出版物"
        )).toBe(
            "计算机科学书目数据库（dblp computer science bibliography）帮助读者查找计算机科学出版物"
        );
    });

    it("does not read Acid inside a multiword English full name as the database acronym ACID", () => {
        const body = "PCR 聚合酶链式反应（Polymerase Chain Reaction）通过引物结合目标脱氧核糖核酸（Deoxyribonucleic Acid）模板并扩增目标片段";
        expect(findReadWeaveQualityIssues(body, "PCR", {
            kind: "term",
            subject: "PCR",
            termIdentity: {
                abbreviation: "PCR",
                chineseName: "聚合酶链式反应",
                englishName: "Polymerase Chain Reaction"
            }
        })).not.toContain("已核验大写标识的大小写不规范：ACID");
    });

    it("rejects a mixed Chinese-comma-English name stuffed into one pair of parentheses", () => {
        expect(findReadWeaveQualityIssues(
            "RAG 检索增强生成（Retrieval-Augmented Generation）让大语言模型（大语言模型大语言模型,Large Language Model）结合外部资料生成回答",
            "RAG",
            {
                kind: "term",
                subject: "RAG",
                termIdentity: {
                    abbreviation: "RAG",
                    chineseName: "检索增强生成",
                    englishName: "Retrieval-Augmented Generation"
                }
            }
        )).toContain("括号内混入了中文重复名称、逗号和英文全称，未使用统一的中英文名称格式");
    });

    it("requires the defining REST constraints instead of accepting a partial resource-only description", () => {
        expect(findReadWeaveQualityIssues(
            "REST 表述性状态转移（Representational State Transfer）强调资源和无状态请求",
            "REST",
            {
                kind: "term",
                subject: "REST",
                termIdentity: {
                    abbreviation: "REST",
                    chineseName: "表述性状态转移",
                    englishName: "Representational State Transfer"
                }
            }
        )).toContain("REST 定义遗漏架构约束中的无状态、统一接口或可缓存性");
    });

    it("requires an NMR definition to connect the external magnetic field to the measured molecular information", () => {
        expect(findReadWeaveQualityIssues(
            "NMR 核磁共振（Nuclear Magnetic Resonance）用射频脉冲激发原子核，并根据弛豫信号推断分子结构",
            "NMR",
            {
                kind: "term",
                subject: "NMR",
                termIdentity: {
                    abbreviation: "NMR",
                    chineseName: "核磁共振",
                    englishName: "Nuclear Magnetic Resonance"
                }
            }
        )).toContain("NMR 定义遗漏外加磁场、原子核共振与分子结构或化学环境之间的核心关系");

        expect(findReadWeaveQualityIssues(
            "NMR 核磁共振（Nuclear Magnetic Resonance）是一种分析技术；它让外加磁场中的原子核在射频激励下产生共振，并从信号中推断分子结构和局部化学环境",
            "NMR",
            {
                kind: "term",
                subject: "NMR",
                termIdentity: {
                    abbreviation: "NMR",
                    chineseName: "核磁共振",
                    englishName: "Nuclear Magnetic Resonance"
                }
            }
        )).not.toContain("NMR 定义遗漏外加磁场、原子核共振与分子结构或化学环境之间的核心关系");
    });

    it("requires GDPR and MIDI definitions to retain their plain-language core relationships", () => {
        expect(findReadWeaveQualityIssues(
            "GDPR 通用数据保护条例（General Data Protection Regulation）是欧盟的数据保护法律框架；它规定数据主体权利以及控制者和处理者的义务",
            "GDPR",
            {
                kind: "term",
                subject: "GDPR",
                termIdentity: {
                    abbreviation: "GDPR",
                    chineseName: "通用数据保护条例",
                    englishName: "General Data Protection Regulation"
                }
            }
        )).toContain("GDPR 定义遗漏个人数据、合法处理依据、数据主体权利与控制者或处理者责任之间的核心关系");

        expect(findReadWeaveQualityIssues(
            "MIDI 乐器数字接口（Musical Instrument Digital Interface）是一种让电子乐器和计算机交换事件消息的技术标准",
            "MIDI",
            {
                kind: "term",
                subject: "MIDI",
                termIdentity: {
                    abbreviation: "MIDI",
                    chineseName: "乐器数字接口",
                    englishName: "Musical Instrument Digital Interface"
                }
            }
        )).toContain("MIDI 定义遗漏电子乐器或软件所交换的音符、力度、控制变化或时序信息");
    });

    it("does not mistake a multi-part ORCID purpose question for a term-definition prompt", () => {
        expect(findReadWeaveQualityIssues(
            "ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）解决了研究人员姓名歧义和身份分散的问题；它保存的核心关系是研究人员身份与研究成果之间的关联",
            "ORCID 解决了什么问题，它保存的核心关系是什么？",
            { kind: "question", knowledgeScope: "general" }
        )).not.toContain("定义开头没有直接说明对象是什么或实际做什么");
    });

    it("does not mistake a short Chinese technical term for a current person because paper metadata has an author", () => {
        const technicalProfile = buildReadWeaveTaskProfile(
            "question",
            "电路划分是什么？请给出通用、详细且通俗的解释"
        );
        expect(isCurrentPersonProfileTask(
            technicalProfile,
            "[selected:term]\n电路划分\n[document:paper]\n作者：Sung Kyu Lim；本文研究基于边可分性的电路聚类"
        )).toBe(false);

        const personProfile = buildReadWeaveTaskProfile(
            "question",
            "“Sung Kyu Lim”是谁？"
        );
        expect(isCurrentPersonProfileTask(
            personProfile,
            "[selected:name]\nSung Kyu Lim\n[document:paper]\n作者：Sung Kyu Lim"
        )).toBe(true);
    });

    it("trusts the exact ORCID canonical English name only after deterministic identity alignment", () => {
        const body = "ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）是一套为研究人员提供的持久数字标识符系统，通过为每位研究者分配唯一标识符来区分重名作者，并连接其研究成果与隶属关系。";
        const profile = buildReadWeaveTaskProfile("term", "ORCID");
        const identity = alignTermIdentityWithEvidencePlan(
            {
                abbreviation: "ORCID",
                englishName: "Open Researcher and Contributor ID"
            },
            undefined,
            profile,
            normalizeReadWeaveEvidencePlan({
                requiredFacts: [ "ORCID 为研究人员提供持久数字标识符" ],
                requiredClaims: [ "说明标识符的作用" ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: [ "核验 ORCID 的规范身份" ],
                entityType: "identifier",
                resolvedSense: "研究人员持久数字标识符"
            })
        );

        expect(identity).toEqual({
            abbreviation: "ORCID",
            chineseName: "开放研究者与贡献者标识符",
            englishName: "Open Researcher and Contributor ID"
        });

        expect(contextGroundingRepairInstructions(
            [ { id: "seg-1", text: body } ],
            "[selected:orcid]\nORCID 为研究人员提供持久数字标识符。",
            profile,
            identity
        )).toEqual([]);
    });

    it("still rejects a generated English full name for an unknown selected term", () => {
        const englishName = "Fabric Optimization and Observation Bridge";
        const repairs = contextGroundingRepairInstructions(
            [ {
                id: "seg-1",
                text: `FOOBAR 结构优化与观测桥（${englishName}）是一种布局优化方法。`
            } ],
            "[selected:foobar]\nFOOBAR 是一种布局优化方法。",
            buildReadWeaveTaskProfile("term", "FOOBAR"),
            {
                abbreviation: "FOOBAR",
                chineseName: "结构优化与观测桥",
                englishName
            }
        );

        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toMatchObject({
            operation: "replace",
            segmentId: "seg-1",
            issue: `英文名称缺少正文证据：${englishName}`
        });
    });

    it("trusts a correctly formatted known AI name instead of repeatedly rejecting its English expansion", () => {
        const repairs = contextGroundingRepairInstructions(
            [ {
                id: "seg-1",
                text: "该会议讨论 AI 人工智能（Artificial Intelligence）驱动的物理设计优化方法。"
            } ],
            "[selected:ispd]\nISPD 是物理设计学术会议，议题包括 AI 驱动的设计空间探索。",
            buildReadWeaveTaskProfile("term", "ISPD"),
            {
                abbreviation: "ISPD",
                chineseName: "物理设计国际研讨会",
                englishName: "International Symposium on Physical Design"
            }
        );

        expect(repairs.filter(repair => repair.issue.includes("Artificial Intelligence"))).toEqual([]);
    });

    it("deletes an unrequested web organization from qualitative QA instead of asking to complete its name", () => {
        const repairs = contextGroundingRepairInstructions(
            [ {
                id: "seg-1",
                text: "NIST 美国国家标准与技术研究院（National Institute of Standards and Technology）还讨论了该技术是否属于国家标准。"
            } ],
            [
                "[selected:scope]",
                "专用集成电路可以为固定工作负载定制数据路径和存储结构，但设计成本高、功能修改空间小。",
                "",
                "[web-evidence-plan:scope-controlled]",
                "{\"requiredFacts\":[\"专用集成电路可以为固定工作负载定制数据路径和存储结构\"],\"requiredClaims\":[\"说明效率来源与工程代价\"]}"
            ].join("\n"),
            buildReadWeaveTaskProfile("question", "专用集成电路与通用处理器相比为什么可能更高效，代价是什么？")
        );

        expect(repairs.some(repair => repair.issue.includes("外围英文项：NIST"))).toBe(true);
        expect(repairs.every(repair => repair.instruction.includes("删除"))).toBe(true);
        expect(repairs.every(repair => repair.instruction.includes("不得返回 need_more_context"))).toBe(true);
        expect(repairs.every(repair => !repair.instruction.includes("补全"))).toBe(true);
    });

    it("removes unsupported heat and parasitic speculation from a local evidence-bound answer", () => {
        const repairs = contextGroundingRepairInstructions(
            [ {
                id: "seg-1",
                text: "背面供电降低电压降后仍不能直接断言性能提高；此外还可能引入额外热阻或寄生效应"
            } ],
            "[selected:boundary]\n背面供电缩短了部分供电路径并释放正面布线资源；材料只报告压降变化，没有给出工作频率、时序裕量或端到端性能测量。",
            buildReadWeaveTaskProfile(
                "question",
                "背面供电降低电压降后，为什么仍不能直接断言芯片性能一定提高？"
            )
        );

        expect(repairs).toContainEqual(expect.objectContaining({
            operation: "replace",
            segmentId: "seg-1",
            issue: "回答引入本地证据未给出的技术效应：热阻、寄生效应"
        }));
    });

    it("never converts a locked RAG abbreviation into the English full-name field", () => {
        const identity = {
            abbreviation: "RAG",
            chineseName: "检索增强生成",
            englishName: "Retrieval-Augmented Generation"
        };
        const aligned = alignTermIdentityWithEvidencePlan(
            identity,
            { abbreviation: "RAG" },
            buildReadWeaveTaskProfile("term", "RAG"),
            normalizeReadWeaveEvidencePlan({
                requiredFacts: [ "RAG 将检索结果用于约束生成" ],
                requiredClaims: [ "说明 RAG 的机制与适用边界" ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: [ "核验 RAG 系统名与英文全称" ],
                entityType: "system",
                resolvedSense: "检索增强生成系统"
            })
        );

        expect(aligned).toEqual(identity);
        expect(aligned?.englishName).not.toBe("RAG");
    });

    it("uses the verified canonical NPU identity instead of a plausible but inconsistent translation", () => {
        const aligned = alignTermIdentityWithEvidencePlan(
            {
                abbreviation: "NPU",
                chineseName: "神经处理单元",
                englishName: "Neural Processing Unit"
            },
            undefined,
            buildReadWeaveTaskProfile("term", "NPU"),
            normalizeReadWeaveEvidencePlan({
                requiredFacts: [ "NPU 面向神经网络工作负载" ],
                requiredClaims: [ "说明专用处理单元的角色" ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: [ "核验 NPU 的中英文全称" ],
                entityType: "processor",
                resolvedSense: "神经网络专用处理单元"
            })
        );

        expect(aligned).toEqual({
            abbreviation: "NPU",
            chineseName: "神经网络处理单元",
            englishName: "Neural Processing Unit"
        });
    });

    it("rejects an unresolved Mercury definition instead of saving an ambiguous answer", () => {
        const issues = findReadWeaveQualityIssues(
            "Mercury 可能是水星或化学元素汞，但当前片段不足以确定唯一义项。",
            "在当前语境中，Mercury 是什么？",
            { kind: "term", subject: "Mercury" }
        );

        expect(issues.join("；")).toMatch(/多个可能义项|尚未.*消歧|唯一义项/u);
    });

    it.each([
        "Mercury 是一个尚未确定具体指代的名称；候选义项包括水星、汞、项目或人物，当前内容没有足够线索选择其中一个。",
        "Mercury 的含义待定，尚无证据排除水星、汞或同名项目这些候选义项。",
        "Mercury 的指代尚不明确，现有材料没有选择具体义项的标准。"
    ])("rejects paraphrased unresolved senses: %s", body => {
        expect(findReadWeaveQualityIssues(body, "在当前语境中，Mercury 是什么？", {
            kind: "term",
            subject: "Mercury"
        }).join("；")).toMatch(/可能义项|消歧/u);
    });

    it.each([
        [ "2 + 2 等于多少？", "2 + 2 = 4。" ],
        [ "门是否已经关闭？", "是，门已经关闭。" ],
        [ "12 比 8 大多少？", "12 比 8 大 4。" ],
        [ "标题是什么？", "标题是芯片设计自动化。" ],
        [ "这篇论文发表于哪一年？", "发表于 2025 年。" ],
        [ "该组织的简称是什么？", "简称是学会。" ],
        [ "什么是奇数？", "奇数是不能被 2 整除的整数。" ]
    ])("does not pad a self-contained short answer merely to meet a fixed length: %s", (question, answer) => {
        const issues = findReadWeaveQualityIssues(answer, question);

        expect(issues).not.toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it("does not misclassify a hyphenated method name or numeric units as abbreviations", () => {
        const body = "DPO-3D 是一种处理可布线性与电压降目标的三维电源网络优化方法；当前样本容量为 32 GB、频率为 2.4 GHz、时延为 10 ms、电压为 5 V。";
        const issues = findReadWeaveQualityIssues(body, "DPO-3D 是什么？", {
            kind: "term",
            subject: "DPO-3D",
            termIdentity: { chineseName: "三维电源网络优化方法" },
            verifiedNonExpandableArtifact: { originalName: "DPO-3D", entityType: "method" }
        });

        expect(issues.filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it("validates a multi-sentence term definition holistically instead of treating a pronoun sentence as a new entity", () => {
        const identity = {
            abbreviation: "NPU",
            chineseName: "神经网络处理单元",
            englishName: "Neural Processing Unit"
        };
        const body = "NPU 神经网络处理单元（Neural Processing Unit）是用于执行神经网络运算的专用处理器。它不等同于完整计算系统，适用边界取决于支持的算子与数值精度。";

        expect(findReadWeaveQualityIssues(body, "在当前语境中，NPU 是什么？", {
            kind: "term",
            subject: "NPU",
            termIdentity: identity
        })).toEqual([]);
    });

    it("rejects an English-only Matrix definition in Chinese definition mode", () => {
        const issues = findReadWeaveQualityIssues(
            "Matrix 是按行和列排列元素的数学对象，可表示线性变换或联立关系，其运算边界由元素所在的代数结构决定。",
            "在当前语境中，Matrix 是什么？",
            {
                kind: "term",
                subject: "Matrix",
                termIdentity: { englishName: "Matrix" }
            }
        );

        expect(issues.join("；")).toMatch(/中文名称|名词身份|格式/u);
        expect(() => validateReadWeaveTermIdentity({ chineseName: "Matrix" })).toThrow(/Chinese name|中文/u);
    });

    it("rejects a QA answer that exceeds the 5000-character machine limit", () => {
        const answer = `结论明确：${"该证据只支持当前问题范围内的判断。".repeat(400)}`;
        expect(answer.length).toBeGreaterThan(6_000);

        const issues = findReadWeaveQualityIssues(answer, "现有证据支持什么结论？");

        expect(issues.join("；")).toMatch(/5000|5,000|长度上限|超出.*上限/u);
    });

    it.each([
        "http://localhost:8082/private",
        "http://127.0.0.1/private",
        "http://10.0.0.1/private",
        "http://172.16.0.1/private",
        "http://192.168.1.1/private",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/private",
        "http://[::ffff:127.0.0.1]/private",
        "http://2130706433/private",
        "https://user:password@example.com/private",
        "file:///etc/passwd"
    ])("rejects a non-public calibration source URL: %s", sourceUrl => {
        expect(isPublicReadWeaveSourceUrl(sourceUrl)).toBe(false);
    });

    it("accepts a credential-free public HTTPS calibration source URL", () => {
        expect(isPublicReadWeaveSourceUrl("https://standards.ieee.org/standard/802_3-2022.html")).toBe(true);
    });

    it("supports β‑VAE as a Unicode abbreviation without losing its canonical identity", () => {
        const identity = validateReadWeaveTermIdentity({
            abbreviation: "β‑VAE",
            chineseName: "贝塔变分自编码器",
            englishName: "Beta Variational Autoencoder"
        });
        const body = "β‑VAE 贝塔变分自编码器（Beta Variational Autoencoder）是一类在变分自编码器目标中加入可调约束权重的生成模型；该权重用于改变重构与潜变量约束之间的取舍。";

        expect(formatReadWeaveTermIdentity(identity)).toBe("β‑VAE 贝塔变分自编码器（Beta Variational Autoencoder）");
        expect(findReadWeaveQualityIssues(body, "在当前语境中，β‑VAE 是什么？", {
            kind: "term",
            subject: "β‑VAE",
            termIdentity: identity
        }).filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([
        [ "3D", "三维", "3D Integrated Circuit" ],
        [ "5G", "第五代移动通信", "Fifth Generation Mobile Network" ],
        [ "2FA", "双因素认证", "Two-Factor Authentication" ],
        [ "C#", "C 井号编程语言", "C Sharp Programming Language" ]
    ])("accepts digit-leading and punctuation-bearing technical abbreviations: %s", (abbreviation, chineseName, englishName) => {
        expect(validateReadWeaveTermIdentity({ abbreviation, chineseName, englishName })).toEqual({
            abbreviation,
            chineseName,
            englishName
        });
    });

    it("does not split the decimal dimensional label 2.5D into a false 5D abbreviation", () => {
        const issues = findReadWeaveQualityIssues(
            "2.5D 集成结构把多个芯粒并排放在共享中介层上，用高密度互连连接这些芯粒。",
            "2.5D 集成结构是什么意思？"
        );

        expect(issues.filter(issue => issue.includes("5D"))).toEqual([]);
    });

    it("rejects a Chinese phrase placed in the abbreviation field", () => {
        expect(() => validateReadWeaveTermIdentity({
            abbreviation: "人工智能",
            chineseName: "人工智能",
            englishName: "Artificial Intelligence"
        })).toThrow(/abbreviation|缩写/iu);
    });

    it.each([ "β‐VAE", "β−VAE" ])("accepts Unicode technical hyphen variants: %s", abbreviation => {
        expect(validateReadWeaveTermIdentity({
            abbreviation,
            chineseName: "贝塔变分自编码器",
            englishName: "Beta Variational Autoencoder"
        }).abbreviation).toBe(abbreviation);
    });

    it.each([
        "VDD/VSS 是芯片的电源与参考地网络。",
        "RESET_N/CLK 分别承担低有效复位和时钟输入。",
        "IR drop 是电源分配网络中的电压下降现象。"
    ])("does not force signal names into bilingual acronym formatting: %s", body => {
        expect(findReadWeaveQualityIssues(body, "这段电路描述说明了什么？")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it("allows a current doctoral-student role in a person's focused definition", () => {
        const body = "Alice Smith 是一名从事电子设计自动化研究的博士生，其当前研究方向用于区分同名人物。";
        expect(findReadWeaveQualityIssues(body, "在当前语境中，Alice Smith 是谁？", {
            kind: "term",
            subject: "Alice Smith",
            termIdentity: { englishName: "Alice Smith" }
        })).not.toContain("定义包含无助于解释术语的履历或书目元数据");
    });

    it("keeps person classification when checking a later definition segment without repeating the name", () => {
        const issues = findReadWeaveQualityIssues(
            "其研究方向包括电子设计自动化与集成电路物理设计。",
            "在当前语境中，Sung Kyu Lim 是谁？",
            {
                kind: "term",
                subject: "Sung Kyu Lim",
                termIdentity: { englishName: "Sung Kyu Lim" },
                entityType: "person"
            }
        );
        expect(issues).not.toContain("非人物英文术语缺少中文名称或中文功能描述");
    });

    it("does not mistake an English concept for a person merely because the body mentions a designer", () => {
        const body = "Neural Network 是设计者用于拟合输入与输出关系的计算模型，其边界取决于训练数据和目标函数。";
        expect(findReadWeaveQualityIssues(body, "在当前语境中，Neural Network 是什么？", {
            kind: "term",
            subject: "Neural Network",
            termIdentity: { englishName: "Neural Network" }
        })).toContain("非人物英文术语缺少中文名称或中文功能描述");
    });

    it("does not accept a one-clause answer for a compound what-and-why question", () => {
        expect(findReadWeaveQualityIssues(
            "它是一种方法。",
            "该优化方法是什么，它为什么能降低延迟？"
        )).toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it.each([
        [ "标题是什么？作者是谁？", "标题是《芯片设计自动化》。" ],
        [ "甲是什么、乙是什么？", "甲是一种优化方法。" ],
        [ "2 + 2 等于多少，为什么？", "4。" ],
        [ "甲乙宽度数值谁更大，为什么？", "甲高于乙 1 毫米。" ]
    ])("requires a complete answer for multi-part questions: %s", (question, answer) => {
        expect(findReadWeaveQualityIssues(answer, question))
            .toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it.each([
        [ "请问，标题是什么？", "标题是《芯片设计自动化》。" ],
        [ "只看摘要，标题是什么？", "标题是《芯片设计自动化》。" ]
    ])("allows a concise direct-fact answer after a natural introductory comma: %s", (question, answer) => {
        expect(findReadWeaveQualityIssues(answer, question))
            .not.toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it.each([
        "AVDD/DVDD 分别为模拟域和数字域供电。",
        "VREF 是模数转换器的参考电压输入。",
        "DATA[7:0] 是八位数据总线。",
        "VALID/READY 共同完成握手。"
    ])("recognizes common EDA rail, bus, and handshake signal names: %s", body => {
        expect(findReadWeaveQualityIssues(body, "这段电路描述说明了什么？")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([ "GPT_5 是一个模型名称。", "SHA_256 是一种摘要算法。" ])(
        "does not treat an arbitrary underscored acronym as an EDA signal: %s",
        body => {
            expect(findReadWeaveQualityIssues(body, "它是什么？").join("；")).toMatch(/缩写/u);
        }
    );

    it.each([
        [ "孙旭林", { chineseName: "孙旭林" }, "孙旭林 是一名从事电子设计自动化研究的博士生，其研究方向用于区分同名人物。" ],
        [ "S. K. Lim", { englishName: "S. K. Lim" }, "S. K. Lim 是一名从事芯片设计自动化研究的博士生，其研究方向用于区分同名人物。" ],
        [ "Ludwig van Beethoven", { englishName: "Ludwig van Beethoven" }, "Ludwig van Beethoven 是一位以交响曲和室内乐作品著称的作曲家。" ]
    ])("recognizes focused person definitions across common name forms: %s", (subject, termIdentity, body) => {
        const issues = findReadWeaveQualityIssues(body, `在当前语境中，${subject} 是谁？`, {
            kind: "term",
            subject,
            termIdentity
        });
        expect(issues).not.toContain("定义包含无助于解释术语的履历或书目元数据");
        expect(issues).not.toContain("非人物英文术语缺少中文名称或中文功能描述");
        expect(issues.filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([
        [ "NPU", { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" }, "NPU 神经网络处理单元（Neural Processing Unit）是一种处理器，用于执行处理任务。" ],
        [ "Sung Kyu Lim", { englishName: "Sung Kyu Lim" }, "Sung Kyu Lim 是一名学者，研究相关问题。" ],
        [ "DPO-3D", { chineseName: "三维可微优化方法" }, "DPO-3D 是一种方法，用于解决优化问题。" ],
        [ "DAC", { abbreviation: "DAC", chineseName: "设计自动化会议", englishName: "Design Automation Conference" }, "DAC 设计自动化会议（Design Automation Conference）是一个专业会议，用于学术交流。" ],
        [ "IEEE", { abbreviation: "IEEE", chineseName: "电气电子工程师学会", englishName: "Institute of Electrical and Electronics Engineers" }, "IEEE 电气电子工程师学会（Institute of Electrical and Electronics Engineers）是一个专业组织，具有重要作用。" ],
        [ "IEEE 802.3", { chineseName: "以太网技术标准", englishName: "IEEE 802.3" }, "以太网技术标准（IEEE 802.3）是一项技术标准，用于规定技术要求。" ]
    ])("rejects entity-shaped but content-free definitions: %s", (subject, termIdentity, body) => {
        expect(findReadWeaveQualityIssues(body, `在当前语境中，${subject} 是什么？`, {
            kind: "term",
            subject,
            termIdentity
        })).toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it("rejects natural words and unexpanded long names in the abbreviation field", () => {
        expect(() => validateReadWeaveTermIdentity({ abbreviation: "hello" })).toThrow(/abbreviation|缩写/iu);
        expect(() => validateReadWeaveTermIdentity({ abbreviation: "ArtificialIntelligence" })).toThrow(/abbreviation|缩写/iu);
    });

    it("accepts the microprocessor abbreviation µP", () => {
        expect(validateReadWeaveTermIdentity({
            abbreviation: "µP",
            chineseName: "微处理器",
            englishName: "Microprocessor"
        }).abbreviation).toBe("µP");
    });

    it.each([
        "三维集成电路（3D Integrated Circuit）是由多个垂直堆叠层构成的集成电路。",
        "C 井编程语言（C# Programming Language）是一种通用编程语言。"
    ])("recognizes digit-leading and punctuation-bearing names inside canonical parentheses: %s", body => {
        expect(findReadWeaveQualityIssues(body, "它是什么？")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it("round-trips every supported canonical identity through one title grammar", () => {
        const identities = [
            { abbreviation: "3D", chineseName: "三维技术", englishName: "Three-Dimensional Technology" },
            { abbreviation: "C#", chineseName: "C 井编程语言", englishName: "C Sharp Programming Language" },
            { abbreviation: "β‑VAE", chineseName: "贝塔变分自编码器", englishName: "Beta Variational Autoencoder" },
            { abbreviation: "µP", chineseName: "微处理器", englishName: "Microprocessor" }
        ];
        for (const identity of identities) {
            const title = formatReadWeaveTermIdentity(identity);
            expect(parseFormattedReadWeaveTermIdentity(title)).toEqual(identity);
            expect(findReadWeaveQualityIssues(`${title} 是具有明确功能边界的技术对象。`, `在当前语境中，${identity.abbreviation} 是什么？`, {
                kind: "term",
                subject: identity.abbreviation,
                termIdentity: identity
            }).filter(issue => issue.includes("缩写"))).toEqual([]);
        }
    });

    it.each([
        [ "3D 三维技术（Three-Dimensional Technology）", "三维技术" ],
        [ "C# C 井编程语言（C Sharp Programming Language）", "C 井编程语言" ],
        [ "β‑VAE 贝塔变分自编码器（Beta Variational Autoencoder）", "贝塔变分自编码器" ]
    ])("deduplicates a complete canonical identity without leaving an abbreviation prefix: %s", (canonical, chineseName) => {
        expect(deduplicateCanonicalNames([
            { id: "first", text: `${canonical} 是第一处定义。` },
            { id: "second", text: `${canonical} 是第二处引用。` }
        ])).toEqual([
            { id: "first", text: `${canonical} 是第一处定义。` },
            { id: "second", text: `${chineseName} 是第二处引用。` }
        ]);
    });

    it("detects circular definitions for digit-leading abbreviations", () => {
        expect(findReadWeaveQualityIssues(
            "3D 三维技术（Three-Dimensional Technology）是一种三维技术。",
            "在当前语境中，3D 是什么？",
            {
                kind: "term",
                subject: "3D",
                termIdentity: {
                    abbreviation: "3D",
                    chineseName: "三维技术",
                    englishName: "Three-Dimensional Technology"
                }
            }
        )).toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it.each([
        "是一种处理器",
        "用于推理的处理器",
        "这是一种技术",
        "一种接口",
        "神经网络处理单元，英文名如下",
        "神经网络处理单元：用于推理",
        "神经网络处理单元。附加说明",
        "神经处理单元(说明)",
        "神经网络\n处理单元"
    ])("rejects a sentence or commentary disguised as a Chinese term name: %s", chineseName => {
        expect(() => validateReadWeaveTermIdentity({
            abbreviation: "NPU",
            chineseName,
            englishName: "Neural Processing Unit"
        })).toThrow(/Chinese term name|中文/u);
    });

    it.each([
        "NPU 是一种处理器（Neural Processing Unit），通过矩阵计算执行推理。",
        "NPU 用于推理的处理器（Neural Processing Unit）通过矩阵计算执行推理。",
        "API 是一种接口（Application Programming Interface），用于连接软件组件。"
    ])("does not accept a descriptive sentence as a canonical Chinese full name: %s", body => {
        expect(findReadWeaveQualityIssues(body, "它是什么？").join("；")).toMatch(/缩写.*格式/u);
    });

    it("keeps format-parse identity round trips stable for valid names", () => {
        const identities = [
            { chineseName: "孙旭林" },
            { chineseName: "网络代理服务", englishName: "Cloudflare WARP" },
            { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" },
            { abbreviation: "C#", chineseName: "C 井号编程语言", englishName: "C Sharp Programming Language" }
        ];
        for (const candidate of identities) {
            const identity = validateReadWeaveTermIdentity(candidate);
            expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(identity))).toEqual(identity);
        }
    });

    it.each([
        [ "eBPF", "扩展伯克利数据包过滤器", "Extended Berkeley Packet Filter" ],
        [ "iSCSI", "互联网小型计算机系统接口", "Internet Small Computer Systems Interface" ],
        [ "eDRAM", "嵌入式动态随机存取存储器", "Embedded Dynamic Random Access Memory" ],
        [ "PCIe", "高速串行计算机扩展总线标准", "Peripheral Component Interconnect Express" ],
        [ "IPv6", "互联网协议第六版", "Internet Protocol Version 6" ],
        [ "x86", "八六系列指令集架构", "x86 Instruction Set Architecture" ]
    ])("round-trips supported mixed-case technical abbreviations: %s", (abbreviation, chineseName, englishName) => {
        const identity = validateReadWeaveTermIdentity({ abbreviation, chineseName, englishName });
        const formatted = formatReadWeaveTermIdentity(identity);
        expect(parseFormattedReadWeaveTermIdentity(formatted)).toEqual(identity);
        expect(findReadWeaveQualityIssues(`${formatted} 是具有明确边界的技术对象。`, "它是什么？")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([ "Npu", "AbC" ])("rejects arbitrary mixed-case words in the abbreviation field: %s", abbreviation => {
        expect(() => validateReadWeaveTermIdentity({ abbreviation })).toThrow(/abbreviation|缩写/iu);
    });

    it.each([ "FinFET", "ReRAM", "FeFET", "ReLU", "SiLU", "cuDNN", "siRNA", "scRNA" ])(
        "round-trips a recognized academic mixed-case abbreviation without widening plain camel words: %s",
        abbreviation => {
            const identity = validateReadWeaveTermIdentity({
                abbreviation,
                chineseName: "学术技术名称",
                englishName: `${abbreviation} Technical Name`
            });
            expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(identity))).toEqual(identity);
        }
    );

    it.each([
        { abbreviation: "DATE", chineseName: "欧洲设计自动化与测试会议", englishName: "Design, Automation & Test in Europe" },
        { abbreviation: "R&D", chineseName: "研究与开发", englishName: "Research & Development" },
        { chineseName: "贝叶斯定理", englishName: "Bayes’ Theorem" },
        { chineseName: "学生氏 t 检验", englishName: "Student’s t-Test" },
        { chineseName: "A 星搜索算法", englishName: "A* Search Algorithm" },
        { chineseName: "H 无穷控制", englishName: "H∞ Control" }
    ])("round-trips official and academic English names containing punctuation: $englishName", candidate => {
        const identity = validateReadWeaveTermIdentity(candidate);
        expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(identity))).toEqual(identity);
    });

    it("supports ampersand abbreviations canonically while still flagging a bare occurrence", () => {
        const identity = validateReadWeaveTermIdentity({
            abbreviation: "P&R",
            chineseName: "布局与布线",
            englishName: "Place and Route"
        });
        const canonical = formatReadWeaveTermIdentity(identity);
        expect(parseFormattedReadWeaveTermIdentity(canonical)).toEqual(identity);
        expect(findReadWeaveQualityIssues(`${canonical} 是物理设计流程中的布局与布线阶段。`, "它是什么？")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
        expect(findReadWeaveQualityIssues("P&R 是物理设计流程中的布局与布线阶段。", "它是什么？"))
            .toContain("缩写 P&R 未使用“缩写 中文全称（英文全称）”格式");
    });

    it.each([ "DPO‐3D", "DPO−3D" ])("recognizes Unicode-hyphen non-expandable artifact names: %s", artifactName => {
        const body = `${artifactName} 是一种处理电源网络约束的三维可微优化方法。`;
        expect(findReadWeaveQualityIssues(body, `${artifactName} 是什么？`, {
            kind: "term",
            subject: artifactName,
            termIdentity: { chineseName: "三维可微优化方法" },
            verifiedNonExpandableArtifact: { originalName: artifactName, entityType: "method" }
        })
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it("keeps the 300-character English-name limit aligned across validate, format, and parse", () => {
        const validEnglishName = `A${"b".repeat(299)}`;
        const identity = validateReadWeaveTermIdentity({ chineseName: "长度边界测试名称", englishName: validEnglishName });
        expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(identity))).toEqual(identity);
        expect(() => validateReadWeaveTermIdentity({
            chineseName: "长度越界测试名称",
            englishName: `A${"b".repeat(300)}`
        })).toThrow(/English full name|英文/u);
    });

    it.each([
        "DPO-3D 三维可微电源优化（Differentiable Power Optimization for 3D）是一种方法，通过把电压降约束写入联合损失并反向传播版图参数梯度，适用于连续松弛后的物理设计参数，用于解决优化问题。",
        "NPU 神经网络处理单元（Neural Processing Unit）是一种处理器，通过并行矩阵乘加单元执行张量运算，其边界取决于支持的算子和数值精度，用于执行处理任务。",
        "DAC 设计自动化会议（Design Automation Conference）是一个专业会议，议题覆盖电子设计自动化算法、工具与芯片系统实现，并通过同行评审论文交流研究成果，用于学术交流。",
        "IEEE 802.3 以太网技术标准（IEEE 802.3 Ethernet Standard）是一项技术标准，规定有线局域网的媒体访问控制与物理层接口，并限定不同速率下的互操作要求，用于规定技术要求。"
    ])("does not reject a substantive definition merely because it ends with a generic phrase: %s", body => {
        expect(findReadWeaveQualityIssues(body, "在当前语境中，它是什么？", { kind: "term" }))
            .not.toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it("round-trips English-only identities and single Greek abbreviations", () => {
        const englishIdentity = validateReadWeaveTermIdentity({ englishName: "Finite State Machine" });
        expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(englishIdentity)))
            .toEqual(englishIdentity);

        const greekIdentity = validateReadWeaveTermIdentity({ abbreviation: "β" });
        expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(greekIdentity)))
            .toEqual(greekIdentity);

        const partialBilingualIdentity = validateReadWeaveTermIdentity({
            abbreviation: "NPU",
            englishName: "Neural Processing Unit"
        });
        expect(parseFormattedReadWeaveTermIdentity(formatReadWeaveTermIdentity(partialBilingualIdentity)))
            .toEqual(partialBilingualIdentity);
    });

    it.each([
        "http://127.0.0.1.nip.io/private",
        "https://localhost.example.com/private",
        "https://example.invalid/source",
        "https://intranet/source",
        "https://device.lan/source",
        "https://x.home/source",
        "https://foo.corp/source",
        "https://example.com/source",
        "https://subdomain.example.net/source",
        "https://ipv4only.arpa/source",
        "https://reserved.alt/source",
        "http://192.88.99.1/source"
    ])("rejects loopback aliases and reserved local hostnames: %s", sourceUrl => {
        expect(isPublicReadWeaveSourceUrl(sourceUrl)).toBe(false);
    });

    it("retains ORCID-to-DOI relationship evidence in a focused ORCID definition plan", () => {
        const plan = normalizeReadWeaveEvidencePlan({
            requiredFacts: [ "ORCID 为研究者提供持久标识符", "ORCID 记录可以关联 DOI 所标识的研究成果" ],
            requiredClaims: [ "说明 ORCID 如何通过 DOI 关系关联研究者与研究成果" ],
            evidenceBoundaries: [ "ORCID 本身不是论文的 DOI" ],
            ambiguities: [],
            canonicalEntityNeeds: [ "核验 ORCID 的规范名称与标识对象" ],
            entityType: "identifier",
            resolvedSense: "研究者持久标识符"
        });
        const pruned = pruneEvidencePlanForProfile(
            plan,
            buildReadWeaveTaskProfile("term", "ORCID"),
            {
                abbreviation: "ORCID",
                chineseName: "开放研究者与贡献者标识符",
                englishName: "Open Researcher and Contributor ID"
            }
        );

        expect(pruned.requiredFacts).toContain("ORCID 记录可以关联 DOI 所标识的研究成果");
        expect(pruned.requiredClaims).toContain("说明 ORCID 如何通过 DOI 关系关联研究者与研究成果");
        expect(pruned.requiredFacts.length + pruned.requiredClaims.length).toBeGreaterThan(0);
    });

    it("retains a method's core PDN mechanism while pruning unrelated acronym comparisons", () => {
        const plan = normalizeReadWeaveEvidencePlan({
            requiredFacts: [ "DPO-3D 面向三维电源网络优化" ],
            requiredClaims: [
                "说明 DPO-3D 如何通过 PDN 优化电源网络",
                "比较外围 ASIC 与 NRE 成本"
            ],
            evidenceBoundaries: [],
            ambiguities: [],
            canonicalEntityNeeds: [ "DPO-3D 是无正式展开的方法原名" ],
            entityType: "method",
            resolvedSense: "三维电源网络可微优化方法"
        });
        const pruned = pruneEvidencePlanForProfile(plan, buildReadWeaveTaskProfile("term", "DPO-3D"), {
            chineseName: "面向三维集成电路的可微电源网络优化方法"
        });

        expect(pruned.requiredClaims).toEqual([ "说明 DPO-3D 如何通过 PDN 优化电源网络" ]);
    });

    it("keeps a fresh current official person role while removing stale local affiliation and biography noise", () => {
        const plan = normalizeReadWeaveEvidencePlan({
            requiredFacts: [
                "Sung Kyu Lim 现任 USC 教授",
                "Sung Kyu Lim 曾任 DARPA 项目经理并当选 IEEE Fellow"
            ],
            requiredClaims: [ "列出 Sung Kyu Lim 的任职、学位与历年成果" ],
            evidenceBoundaries: [ "UCLA 学位年份未确认" ],
            ambiguities: [],
            canonicalEntityNeeds: [ "Sung Kyu Lim 是人物姓名" ],
            entityType: "concept",
            resolvedSense: "Electronic Design Automation"
        });
        const local = "[selected:selected]\nSung Kyu Lim 是佐治亚理工学院教授，研究方向包括电子设计自动化与集成电路物理设计。";
        const pruned = pruneEvidencePlanForProfile(
            plan,
            buildReadWeaveTaskProfile("term", "Sung Kyu Lim"),
            undefined,
            local
        );

        expect(pruned.entityType).toBe("person");
        expect(pruned.requiredFacts).toEqual([
            "Sung Kyu Lim 现任 USC 教授"
        ]);
        expect(JSON.stringify(pruned)).not.toMatch(/佐治亚理工|DARPA|IEEE|UCLA|学位|曾任/u);
    });

    it("drops unsupported neighboring method acronyms from every scoped plan field", () => {
        const plan = normalizeReadWeaveEvidencePlan({
            requiredFacts: [ "DPO-3D 使用 GPU 与 DCO-3D 协同求解" ],
            requiredClaims: [ "比较 DPO-3D、DCO-3D 与 GPU 实现" ],
            evidenceBoundaries: [ "DCO-3D 的 IC 流程不在本文证明范围" ],
            ambiguities: [ "DPO-3D 与 DCO-3D 的关系待比较" ],
            canonicalEntityNeeds: [ "DPO-3D 是方法原名，没有正式英文展开" ],
            entityType: "method",
            resolvedSense: "三维电源网络优化方法"
        });
        const local = "[selected:selected]\nDPO-3D 是面向三维集成电路电源分配网络的可微优化方法，用于处理可布线性与电压降目标。";
        const pruned = pruneEvidencePlanForProfile(
            plan,
            buildReadWeaveTaskProfile("term", "DPO-3D"),
            { chineseName: "面向三维集成电路的可微电源网络优化方法" },
            local
        );

        expect(JSON.stringify(pruned)).not.toMatch(/DCO-3D|GPU|\bIC\b/u);
        expect(pruned.requiredFacts[0]).toContain("可微优化方法");
        expect(pruned.canonicalEntityNeeds).toEqual([ "DPO-3D 是方法原名，没有正式英文展开" ]);
    });

    it("preserves valid generated identity fields when a sibling field is malformed", () => {
        expect(mergeReadWeaveTermIdentity({
            abbreviation: "ORCID",
            chineseName: "开放研究人员和贡献者 ID",
            englishName: "Open Researcher and Contributor ID"
        }, {})).toEqual({
            abbreviation: "ORCID",
            chineseName: undefined,
            englishName: "Open Researcher and Contributor ID"
        });
    });

    it.each([
        "检验采用显著性水平 α=0.05，并报告 β 所表示的第二类错误概率。",
        "µ=0 表示总体均值。",
        "L=αL1+βL2。",
        "L=λL1+(1−λ)L2，其中 L1 与 L2 是两个损失项。",
        "电压降满足 ΔV=IR。",
        "正则项采用 L1 范数与 L2 范数。",
        "S/N 信噪比与 E/H 场比用于描述两组测量结果。",
        "信噪比可以写为 S/N。",
        "电场与磁场的关系写为 E/H。",
        "XY 坐标表示版图中的平面位置。"
    ])("does not rewrite mathematical, electrical, or coordinate notation as a prose abbreviation: %s", body => {
        expect(findReadWeaveQualityIssues(body, "解释该论文中的计算结果")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([
        "参数 MAX_ITER 控制最大迭代次数。",
        "寄存器字段 CTRL_EN 控制模块使能。",
        "差分信号 INP/INN 连接比较器输入端。",
        "时序约束 MAX_DELAY=10 ns。",
        "环境变量 CUDA_VISIBLE_DEVICES 限定可见设备。",
        "宏定义 ENABLE_TRACE 控制跟踪日志。"
    ])("does not rewrite an explicitly identified code, configuration, or signal name: %s", body => {
        expect(findReadWeaveQualityIssues(body, "解释该工程配置")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([
        "GPT_5 是一个模型名称。",
        "SHA_256 是一种摘要算法。"
    ])("does not exempt an arbitrary underscored acronym without identifier context: %s", body => {
        expect(findReadWeaveQualityIssues(body, "它是什么？").join("；"))
            .toMatch(/缩写/u);
    });

    it.each([
        "CO2 浓度随时间升高。",
        "H2O 分子由氢和氧组成。",
        "O2 含量低于阈值。",
        "NH3 气体用于该反应。",
        "CO 气体参与该反应。",
        "NO 分子是反应中间体。",
        "BN 材料形成绝缘层。",
        "OH 自由基参与氧化过程。"
    ])("does not rewrite a contextualized chemical formula as an abbreviation: %s", body => {
        expect(findReadWeaveQualityIssues(body, "解释该实验观察")
            .filter(issue => issue.includes("缩写"))).toEqual([]);
    });

    it.each([ "NPU 是一种处理器。", "BEOL 是芯片制造阶段。" ])(
        "keeps ordinary technical abbreviations strict outside notation context: %s",
        body => {
            expect(findReadWeaveQualityIssues(body, "它是什么？").join("；"))
                .toMatch(/缩写/u);
        }
    );

    it("requires the canonical structured identity during generation, matching the save contract", () => {
        const termIdentity = {
            abbreviation: "VREF",
            chineseName: "参考电压",
            englishName: "Voltage Reference"
        };
        const bareIssues = findReadWeaveQualityIssues(
            "VREF 是为模数转换器提供比较基准的稳定电压，其精度受噪声和温漂限制。",
            "在当前语境中，VREF 是什么？",
            { kind: "term", subject: "VREF", termIdentity }
        );
        const canonicalIssues = findReadWeaveQualityIssues(
            "VREF 参考电压（Voltage Reference）是为模数转换器提供比较基准的稳定电压，其精度受噪声和温漂限制。",
            "在当前语境中，VREF 是什么？",
            { kind: "term", subject: "VREF", termIdentity }
        );

        expect(bareIssues).toContain("定义正文未明确指向结构化名词身份");
        expect(canonicalIssues).not.toContain("定义正文未明确指向结构化名词身份");
    });

    it("accepts a canonical definition whose first predicate is 用于", () => {
        const termIdentity = {
            abbreviation: "TESS",
            chineseName: "凌日系外行星巡天卫星",
            englishName: "Transiting Exoplanet Survey Satellite"
        };
        const body = "TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）用于通过恒星亮度的周期性下降寻找候选系外行星；";

        expect(findReadWeaveQualityIssues(body, "在当前语境中，TESS 是什么？", {
            kind: "term",
            subject: "TESS",
            termIdentity
        })).not.toContain("定义正文未明确指向结构化名词身份");
    });

    it("accepts a canonical definition with an explicit alias before its first predicate", () => {
        const termIdentity = {
            abbreviation: "DAC",
            chineseName: "设计自动化会议",
            englishName: "Design Automation Conference"
        };
        const body = "DAC 设计自动化会议（Design Automation Conference），又称芯片到系统会议（The Chips to Systems Conference），是电子设计自动化和芯片/系统设计领域公认的首要学术会议。该会议接收并报告芯片物理设计等方向的研究论文，涵盖设计自动化、人工智能、设计方法、系统、安全等支柱主题，是学术界与工业界交流的重要平台。";

        expect(findReadWeaveQualityIssues(body, "在当前语境中，DAC 是什么？", {
            kind: "term",
            subject: "DAC",
            termIdentity
        })).not.toContain("定义正文未明确指向结构化名词身份");
    });

    it.each([
        [ "NPU 是什么？", "处理器" ],
        [ "什么是 DPO-3D？", "算法" ],
        [ "EDA 是什么？", "技术" ],
        [ "BS-PDN-Last 是什么？", "一种方法" ]
    ])("rejects a label-only answer to a generic definition question: %s", (question, answer) => {
        expect(findReadWeaveQualityIssues(answer, question))
            .toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it.each([
        [ "图中颜色是什么？", "蓝色" ],
        [ "参数数值是什么？", "42" ],
        [ "单位是什么？", "纳秒" ],
        [ "会议地点是什么？", "旧金山" ],
        [ "截止时间是什么？", "下午三点" ],
        [ "论文作者是什么？", "孙旭林" ],
        [ "数据类型是什么？", "整数" ]
    ])("keeps an explicit attribute lookup concise: %s", (question, answer) => {
        expect(findReadWeaveQualityIssues(answer, question))
            .not.toContain("答案过于简略，未形成足够的解释与证据闭环");
    });

    it.each([
        "NPU 是一种处理器，具有很高的性能和非常广泛的应用价值，用于执行处理任务。",
        "该方法是一种方法，用于解决优化问题，并具有先进、专业、可靠、有效等显著特点。",
        "DAC 是一项会议，用于学术交流，并具有重要、广泛和深远的行业影响。",
        "IEEE 是一个组织，用于学术交流，并在相关领域发挥着非常重要且广泛的作用。"
    ])("rejects praise-filled definitions that still contain no distinguishing mechanism: %s", body => {
        expect(findReadWeaveQualityIssues(body, "在当前语境中，它是什么？", {
            kind: "term",
            subject: body.split(" ")[0]
        })).toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it("accepts hardware accelerator as a processor-class definition", () => {
        const termIdentity = {
            abbreviation: "NPU",
            chineseName: "神经网络处理单元",
            englishName: "Neural Processing Unit"
        };
        const body = "NPU 神经网络处理单元（Neural Processing Unit）是用于神经网络张量运算的专用硬件加速器，通过矩阵乘加阵列和片上数据复用提高推理吞吐量，适用边界受算子支持与内存带宽限制。";

        expect(findReadWeaveQualityIssues(body, "在当前语境中，NPU 是什么？", {
            kind: "term",
            subject: "NPU",
            termIdentity
        })).not.toContain("结构化名词身份与定义正文的实体类别或义项不一致");
    });

    it.each([
        "矩阵（Matrix）就是矩阵（Matrix）。",
        "矩阵（Matrix）指的是矩阵（Matrix）。",
        "矩阵（Matrix）表示矩阵（Matrix）。"
    ])("uses the shared semantic gate to reject a non-abbreviation circular definition: %s", body => {
        const termIdentity = { chineseName: "矩阵", englishName: "Matrix" };
        expect(findReadWeaveTermDefinitionSemanticIssues(body, "矩阵（Matrix）", termIdentity))
            .toContain("定义只是同义反复，没有说明对象角色或边界");
        expect(findReadWeaveQualityIssues(body, "在当前语境中，矩阵是什么？", {
            kind: "term",
            subject: "矩阵",
            termIdentity
        })).toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it("rejects a complete canonical abbreviation repeated as its own definition", () => {
        const termIdentity = {
            abbreviation: "ORCID",
            chineseName: "开放研究者与贡献者标识符",
            englishName: "Open Researcher and Contributor ID"
        };
        const canonical = formatReadWeaveTermIdentity(termIdentity);
        expect(findReadWeaveQualityIssues(`${canonical}就是${canonical}。`, "在当前语境中，ORCID 是什么？", {
            kind: "term",
            subject: "ORCID",
            termIdentity
        })).toContain("定义只是同义反复，没有说明对象角色或边界");
    });

    it.each([
        "矩阵（Matrix）属于一种常见的数学概念。",
        "矩阵（Matrix）表示一种数学概念。",
        "矩阵（Matrix）是一种广泛使用的数学对象。",
        "矩阵（Matrix）是一种应用广泛的数学对象。",
        "矩阵（Matrix）是一个相关的数学对象。",
        "矩阵（Matrix）是一种数学对象之一。"
    ])("rejects the same generic definition before review and at save time: %s", body => {
        const termIdentity = { chineseName: "矩阵", englishName: "Matrix" };
        expect(findReadWeaveTermDefinitionSemanticIssues(body, "矩阵（Matrix）", termIdentity))
            .toContain("定义过于宽泛，未给出可区分该对象的具体特征");
        expect(findReadWeaveQualityIssues(body, "在当前语境中，矩阵是什么？", {
            kind: "term",
            subject: "矩阵",
            termIdentity
        })).toContain("定义过于宽泛，未给出可区分该对象的具体特征");
    });

    it.each([
        [ "矩阵（Matrix）是数组。", "矩阵", { chineseName: "矩阵", englishName: "Matrix" } ],
        [ "傅里叶变换（Fourier Transform）是积分。", "傅里叶变换", { chineseName: "傅里叶变换", englishName: "Fourier Transform" } ],
        [ "π 圆周率（Pi）是常数。", "π", { abbreviation: "π", chineseName: "圆周率", englishName: "Pi" } ]
    ])("measures definition detail after removing a long canonical identity: %s", (body, subject, termIdentity) => {
        expect(findReadWeaveQualityIssues(body, `在当前语境中，${subject}是什么？`, {
            kind: "term",
            subject,
            termIdentity
        })).toContain("定义过于简略，未说明对象的类型、角色、机制或边界");
    });

    it.each([
        "规范中的 MUST 是绝对要求，SHOULD 允许有充分理由的例外，MAY 表示可选行为；",
        "语义化版本使用 MAJOR.MINOR.PATCH；MAJOR 表示不兼容变化，MINOR 表示向后兼容功能，PATCH 表示兼容性修复；"
    ])("treats uppercase English specification keywords as labels instead of abbreviations: %s", body => {
        expect(findReadWeaveQualityIssues(body, "解释这些规范关键词")).toEqual([]);
    });

    it.each([
        [ "PCR", "PCR 聚合酶链式反应（Polymerase Chain Reaction）" ],
        [ "mRNA", "mRNA 信使核糖核酸（Messenger Ribonucleic Acid）" ],
        [ "GDPR", "GDPR 通用数据保护条例（General Data Protection Regulation）" ],
        [ "REST", "REST 表述性状态转移（Representational State Transfer）" ],
        [ "TLS", "TLS 传输层安全协议（Transport Layer Security）" ],
        [ "RAM", "RAM 随机存取存储器（Random Access Memory）" ],
        [ "dB", "dB 分贝（Decibel）" ],
        [ "morpheme", "语素（Morpheme）" ]
    ])("provides a deterministic cross-domain canonical identity for %s", (subject, canonical) => {
        const identity = alignTermIdentityWithEvidencePlan(
            parseFormattedReadWeaveTermIdentity(canonical),
            undefined,
            buildReadWeaveTaskProfile("term", subject),
            normalizeReadWeaveEvidencePlan({
                requiredFacts: [ `${subject} 的通用定义` ],
                requiredClaims: [ `说明 ${subject} 的含义` ],
                evidenceBoundaries: [],
                ambiguities: [],
                canonicalEntityNeeds: [ `核验 ${subject} 的规范名称` ],
                entityType: "concept"
            })
        );
        expect(formatReadWeaveTermIdentity(identity ?? {})).toBe(canonical);
    });

    it("keeps a formal English product name in parentheses instead of classifying it as a standalone research code", () => {
        const profile = buildReadWeaveTaskProfile("question", "Cloudflare WARP 在这里是什么？");
        const plan = normalizeReadWeaveEvidencePlan({
            requiredFacts: [ "Cloudflare WARP 是网络连接产品" ],
            requiredClaims: [ "说明产品用途" ],
            evidenceBoundaries: [ "WARP 没有逐字母英文展开" ],
            ambiguities: [],
            canonicalEntityNeeds: [ "Cloudflare WARP 是产品原名，不是可展开缩写" ],
            entityType: "product"
        });
        expect(resolveVerifiedNonExpandableArtifact(profile, plan)).toBeUndefined();
        expect(findReadWeaveQualityIssues(
            "Cloudflare 提供的网络连接产品（Cloudflare WARP）用于保护设备到其网络边缘之间的连接；",
            profile.objective
        )).toEqual([]);
    });

    it("repairs adjacent Chinese definition clauses that lost their separator", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "其序列包含编码区和非翻译区等结构该分子在基因表达中充当翻译模板"
        )).toBe("其序列包含编码区和非翻译区等结构；该分子在基因表达中充当翻译模板");
        expect(normalizeReadWeaveGeneratedBody(
            "核糖体把氨基酸连接成多肽链该分子随后被释放"
        )).toBe("核糖体把氨基酸连接成多肽链；该分子随后被释放");
        expect(normalizeReadWeaveGeneratedBody(
            "信使核糖核酸是一种单链核糖核酸该对象在基因表达中充当翻译模板"
        )).toBe("信使核糖核酸是一种单链核糖核酸；该对象在基因表达中充当翻译模板");
    });

    it("restores a known canonical subject when a model repair accidentally drops its opening", () => {
        const identity = {
            abbreviation: "GDPR",
            chineseName: "通用数据保护条例",
            englishName: "General Data Protection Regulation"
        };
        expect(ensureReadWeaveDefinitionSubjectOpening(
            "欧盟关于个人数据处理合法性、数据主体权利与控制者责任的法规",
            "GDPR",
            identity,
            "[selected]\nGDPR 规定个人数据处理的合法性基础"
        )).toBe(
            "GDPR 通用数据保护条例（General Data Protection Regulation）是欧盟关于个人数据处理合法性、数据主体权利与控制者责任的法规"
        );
        expect(ensureReadWeaveDefinitionSubjectOpening(
            "mRNA 信使核糖核酸（Messenger Ribonucleic Acid）是主要用途是指导核糖体组装氨基酸并合成蛋白质",
            "mRNA",
            {
                abbreviation: "mRNA",
                chineseName: "信使核糖核酸",
                englishName: "Messenger Ribonucleic Acid"
            },
            "[selected]\nmRNA 是蛋白质翻译的模板"
        )).toBe(
            "mRNA 信使核糖核酸（Messenger Ribonucleic Acid）用于指导核糖体组装氨基酸并合成蛋白质"
        );
    });

    it("restores an unknown project code only when the selected evidence directly defines it", () => {
        expect(ensureReadWeaveDefinitionSubjectOpening(
            "团队内部开发的多模态检索原型；该名称不是英文首字母缩写",
            "Orion-X",
            undefined,
            "[selected]\nOrion-X 是团队内部为多模态检索原型使用的项目代号"
        )).toBe("Orion-X是团队内部开发的多模态检索原型；该名称不是英文首字母缩写");
        expect(ensureReadWeaveDefinitionSubjectOpening(
            "可能指水星、汞或同名项目",
            "Mercury",
            undefined,
            "[selected]\nMercury 的具体义项不明"
        )).toBe("可能指水星、汞或同名项目");
    });

    it("collapses a duplicated Chinese label before its English canonical name", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "设备只有 8 GB 随机存取存储器随机存取存储器（Random Access Memory）"
        )).toBe("设备只有 8 GB 随机存取存储器（Random Access Memory）");
    });

    it("preserves a mathematical division slash between Chinese operands", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "市盈率的计算公式为股价/每股收益"
        )).toBe("市盈率的计算公式为股价/每股收益");
    });

    it("rejects a term draft that substitutes a boundary or misleading payback example for its definition", () => {
        const mrnaIdentity = {
            abbreviation: "mRNA",
            chineseName: "信使核糖核酸",
            englishName: "Messenger Ribonucleic Acid"
        };
        expect(findReadWeaveQualityIssues(
            "mRNA 信使核糖核酸（Messenger Ribonucleic Acid）是边界在于该对象最终会被降解",
            "mRNA",
            { kind: "term", subject: "mRNA", termIdentity: mrnaIdentity }
        )).toContain("定义只写了适用边界，没有先说明对象的核心角色或机制");

        const peIdentity = {
            abbreviation: "P/E",
            chineseName: "市盈率",
            englishName: "Price-to-Earnings Ratio"
        };
        expect(findReadWeaveQualityIssues(
            "P/E 市盈率（Price-to-Earnings Ratio）是财务估值指标；计算公式为股价每股收益；该数值表示几年能够收回投资",
            "P/E",
            { kind: "term", subject: "P/E", termIdentity: peIdentity }
        )).toEqual(expect.arrayContaining([
            "比率公式缺少除法运算符",
            "市盈率被误写成投资回收期"
        ]));
        expect(findReadWeaveQualityIssues(
            "P/E 市盈率（Price-to-Earnings Ratio）是一种用于比较市场价值与盈利能力的估值指标",
            "P/E",
            { kind: "term", subject: "P/E", termIdentity: peIdentity }
        )).toContain("市盈率定义遗漏价格除以每股收益这一核心关系");
    });

    it("reads the first complete JSON object when a model appends prose or a second object", () => {
        expect(parseJsonObject<{ body: string }>(
            "```json\n{\"body\":\"主体包含 } 字符\"}\n```\n额外解释\n{\"ignored\":true}"
        )).toEqual({ body: "主体包含 } 字符" });
    });

    it("builds a complete grounded mRNA fallback from the selected sentence", () => {
        const identity = {
            abbreviation: "mRNA",
            chineseName: "信使核糖核酸",
            englishName: "Messenger Ribonucleic Acid"
        };
        const body = buildDirectSelectedTermFallback(
            buildReadWeaveTaskProfile("term", "mRNA"),
            "[selected:selected]\nmRNA 把 DNA 中的遗传信息携带到核糖体，作为蛋白质翻译的模板。",
            identity
        );
        expect(body).toBe(
            "mRNA 信使核糖核酸（Messenger Ribonucleic Acid）把 DNA 脱氧核糖核酸（Deoxyribonucleic Acid）中的遗传信息携带到核糖体，作为蛋白质翻译的模板"
        );
        expect(findReadWeaveQualityIssues(body!, "mRNA", {
            kind: "term",
            subject: "mRNA",
            termIdentity: identity
        })).toEqual([]);
    });

    it("builds a complete grounded NMR fallback after a model corrupts its canonical parentheses", () => {
        const identity = {
            abbreviation: "NMR",
            chineseName: "核磁共振",
            englishName: "Nuclear Magnetic Resonance"
        };
        const body = buildDirectSelectedTermFallback(
            buildReadWeaveTaskProfile("term", "NMR"),
            "[selected:selected]\nNMR 利用原子核在磁场中的共振响应来推断分子结构和局部化学环境。",
            identity
        );
        expect(body).toBe(
            "NMR 核磁共振（Nuclear Magnetic Resonance）利用原子核在磁场中的共振响应来推断分子结构和局部化学环境"
        );
        expect(findReadWeaveQualityIssues(body!, "NMR", {
            kind: "term",
            subject: "NMR",
            termIdentity: identity
        })).toEqual([]);
    });

    it("requires the package-interconnect boundary in a Chiplet definition", () => {
        expect(findReadWeaveQualityIssues(
            "芯粒（Chiplet）把大型单片功能拆成多个可独立制造的晶粒",
            "Chiplet",
            { kind: "term", subject: "Chiplet", knowledgeScope: "general" }
        )).toContain("芯粒定义遗漏了独立晶粒通过封装互连组合成系统这一核心特征");
    });

    it("requires the concrete shared cause in the ice-cream correlation example", () => {
        expect(findReadWeaveQualityIssues(
            "不能据此判断因果关系；两者可能受共同的混杂变量影响",
            "冰淇淋销量与溺水人数同时上升，能否据此判断冰淇淋导致溺水？",
            { kind: "question", knowledgeScope: "contextual" }
        )).toContain("相关性与因果性回答遗漏了气温或夏季这一共同原因");
    });

    it("rejects run-on definitions that glue a noun directly to 该对象", () => {
        expect(findReadWeaveQualityIssues(
            "SVD 奇异值分解（Singular Value Decomposition）将矩阵分成方向与奇异值；它可理解为旋转操作该对象还可揭示有效秩",
            "SVD",
            {
                kind: "term",
                subject: "SVD",
                knowledgeScope: "general",
                termIdentity: {
                    abbreviation: "SVD",
                    chineseName: "奇异值分解",
                    englishName: "Singular Value Decomposition"
                }
            }
        )).toContain("定义中的相邻语义单元与“该对象”粘连，句意不通");
    });

    it("expands a known camel-case abbreviation every time it appears", () => {
        expect(findReadWeaveQualityIssues(
            "芯粒（Chiplet）可以组合成 SoC",
            "Chiplet",
            { kind: "term", subject: "Chiplet", knowledgeScope: "general" }
        )).toContain("缩写 SoC 未使用“缩写 中文全称（英文全称）”格式");
    });

    it("does not mistake the ordinary word acid for the ACID database acronym", () => {
        expect(findReadWeaveQualityIssues(
            "PCR 聚合酶链式反应（Polymerase Chain Reaction）通过反复循环扩增特定核酸片段；nucleic acid 表示核酸",
            "PCR",
            {
                kind: "term",
                subject: "PCR",
                knowledgeScope: "general",
                termIdentity: {
                    abbreviation: "PCR",
                    chineseName: "聚合酶链式反应",
                    englishName: "Polymerase Chain Reaction"
                }
            }
        )).not.toContain("缩写 ACID 未使用“缩写 中文全称（英文全称）”格式");
    });

    it("checks every abbreviation occurrence instead of only the primary term", () => {
        const complete = [
            "CPU 中央处理器（Central Processing Unit）负责执行通用程序指令",
            "GPU 图形处理器（Graphics Processing Unit）更适合同时处理大量相似运算",
            "中央处理器与图形处理器承担不同类型的计算工作"
        ].join("；");
        expect(findReadWeaveQualityIssues(
            complete,
            "CPU 与 GPU 有什么区别？",
            { kind: "question", knowledgeScope: "general" }
        )).not.toEqual(expect.arrayContaining([
            expect.stringContaining("未使用“缩写 中文全称")
        ]));

        expect(findReadWeaveQualityIssues(
            `${complete}；CPU 还负责协调系统中的通用控制流程`,
            "CPU 与 GPU 有什么区别？",
            { kind: "question", knowledgeScope: "general" }
        )).toContain("缩写 CPU 未使用“缩写 中文全称（英文全称）”格式");
    });

    it("treats dblp as a verified proper name instead of inventing a non-expandable acronym claim", () => {
        const identity = parseFormattedReadWeaveTermIdentity(
            "计算机科学书目数据库（dblp computer science bibliography）"
        );
        const body = "计算机科学书目数据库（dblp computer science bibliography）是一个开放的计算机科学书目信息服务；它帮助读者查找作者、论文、会议和期刊的书目记录";
        expect(identity).toEqual({
            chineseName: "计算机科学书目数据库",
            englishName: "dblp computer science bibliography"
        });
        expect(findReadWeaveQualityIssues(body, "DBLP", {
            kind: "term",
            subject: "DBLP",
            termIdentity: identity,
            knowledgeScope: "general",
            entityType: "system"
        })).toEqual([]);
    });

    it("enforces a short plain-language opening before technical mechanisms", () => {
        const hardOpening = "边可分性通过采用多层超图结构进行跨层连接关系概率建模并实现面向层次化电路聚类过程的全局划分质量优化与拓扑边界表征";
        expect(findReadWeaveQualityIssues(
            `${hardOpening}；它随后输出连接作为切割边的相对倾向`,
            "边可分性是什么？",
            { kind: "question", subject: "边可分性", knowledgeScope: "general" }
        )).toEqual(expect.arrayContaining([
            "定义开头没有直接说明对象是什么或实际做什么",
            "定义开头堆叠了多层机制动作，应先讲通俗作用再展开技术机制"
        ]));

        const plain = "边可分性是衡量一条连接适不适合作为分组边界的指标；数值越能反映两侧节点容易被分开，这条连接越适合作为切割位置；具体算法可以再用图或超图中的连接关系计算该指标";
        expect(findReadWeaveQualityIssues(
            plain,
            "边可分性是什么？",
            { kind: "question", subject: "边可分性", knowledgeScope: "general" }
        )).toEqual([]);
    });

    it("does not misclassify a parenthetical measurement comparison as a bilingual-name error", () => {
        expect(findReadWeaveQualityIssues(
            "不能判断；证据只给出了工作负载 X 下的功耗对比（方案 A 70 mW,方案 B 82 mW），没有提供其他工作负载的测量数据，因此无法判断方案 A 在所有工作负载下都更省电；",
            "能否根据这段数据判断方案在所有工作负载下都更省电？",
            { kind: "question", knowledgeScope: "contextual" }
        )).not.toContain("括号内混入了中文重复名称、逗号和英文全称，未使用统一的中英文名称格式");
    });

    it("rejects a repeated CBT name and a definition missing its core plain-language relationship", () => {
        const body = "CBT 认知行为疗法（Cognitive Behavioral Therapy）为疗法（Cognitive Behavioral Therapy）是一种心理治疗方法；它训练新的行为来减轻症状";
        expect(findReadWeaveQualityIssues(
            body,
            "CBT",
            {
                kind: "term",
                subject: "CBT",
                termIdentity: {
                    abbreviation: "CBT",
                    chineseName: "认知行为疗法",
                    englishName: "Cognitive Behavioral Therapy"
                },
                knowledgeScope: "general"
            }
        )).toEqual(expect.arrayContaining([
            "核心术语规范名称后重复英文全称：CBT",
            "CBT 定义遗漏思维、行为与情绪或应对方式之间的核心关系"
        ]));
    });

    it("rejects an unsupported graph-theory expansion of the paper-specific edge-separability term", () => {
        expect(findReadWeaveQualityIssues(
            "边可分性（edge separability）是图论与网络分析中的一个度量；它通常定义为移除该边后的连通分量变化；该概念与边介数类似",
            "边可分性",
            {
                kind: "term",
                subject: "边可分性",
                termIdentity: { chineseName: "边可分性", englishName: "edge separability" },
                knowledgeScope: "general"
            }
        )).toContain("边可分性定义加入了选区未支持的泛化图论义项或相邻指标");
    });

    it("drops exclusion-only author metadata from a direct selected-term fallback", () => {
        const fallback = buildDirectSelectedTermFallback(
            buildReadWeaveTaskProfile("term", "边可分性"),
            "[selected:selected]\n在电路聚类语境中，边可分性衡量一条连接是否适合作为分开不同节点组的边界；论文作者信息不属于该术语的定义。",
            { chineseName: "边可分性", englishName: "edge separability" }
        );
        expect(fallback).toBe(
            "边可分性（edge separability）衡量一条连接是否适合作为分开不同节点组的边界"
        );
        expect(fallback).not.toMatch(/作者|不属于/u);
    });

    it("separates an NMR use clause from its applicability boundary", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "用于研究分子动力学、相互作用及反应过程适用边界包括样品需含有可观测核"
        )).toContain("反应过程；适用边界");
        expect(normalizeReadWeaveGeneratedBody(
            "检测信号可获得化学位移和耦合常数等信息适用范围包括具有磁矩的原子核"
        )).toContain("信息；适用范围");
    });

    it("separates conditional R0 branches and requires concrete ACID failure assumptions", () => {
        expect(normalizeReadWeaveGeneratedBody(
            "若该对象大于 1，疫情可能扩散若该对象小于 1，疫情逐渐消退"
        )).toBe("若该对象大于 1，疫情可能扩散；若该对象小于 1，疫情逐渐消退");

        expect(findReadWeaveQualityIssues(
            "不能；ACID 原子性、一致性、隔离性与持久性（Atomicity, Consistency, Isolation, and Durability）中的持久性依赖具体实现和硬件假设",
            "数据库声称支持 ACID，能否据此断言任何硬件故障都不会丢数据？",
            { kind: "question", knowledgeScope: "contextual" }
        )).toContain("ACID 故障边界回答没有说明持久性仍依赖的存储、刷盘、日志、复制或备份恢复条件");
    });
});
