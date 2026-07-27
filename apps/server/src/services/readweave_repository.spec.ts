import { becca, cls, hidden_subtree as hiddenSubtreeService, note_service as noteService } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
    deleteReadWeaveLink,
    editReadWeaveLink,
    exportReadWeave,
    getAnchorSummaries,
    getEntriesForAnchor,
    getReadWeaveImpact,
    saveReadWeaveEntry
} from "./readweave_repository.js";
import sqlInit from "./sql_init.js";

function professionalAnswer(conclusion: string): string {
    return `${[
        `定义与命名：${conclusion}`,
        "底层构造：引用通过对象标识符解析规范内容",
        "层次关系：规范对象独立于文章链接并可被多篇文章引用",
        "参数配置：链接保存对象标识符而不是可变显示名称",
        "行为语义：规范对象更新后所有普通引用同步解析新内容",
        "测试判据：修改规范对象后两个文章链接都应显示同一修订内容",
        "数字推导：测试资料没有数值参数，因此不能进行数字推导",
        "实现选择与证据闭环：不可变标识符避免重名与改名漂移并由跨文章同步测试验证"
    ].join("；")  }；`;
}

describe("ReadWeave repository", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    it("keeps identifier-based links synchronized while supporting variants and display overrides", () => {
        cls.init(() => {
            const firstArticle = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave test article A",
                type: "text",
                mime: "text/html",
                content: "<p>First source paragraph.</p>"
            }).note;
            const secondArticle = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave test article B",
                type: "text",
                mime: "text/html",
                content: "<p>Second source paragraph.</p>"
            }).note;

            const first = saveReadWeaveEntry({
                articleId: firstArticle.noteId,
                anchorId: "rw_anchor_a",
                anchorType: "range",
                kind: "question",
                title: "What is an identifier link?",
                body: professionalAnswer("标识符链接通过不可变对象标识符解析内容"),
                sourceExcerpt: "First source paragraph.",
                calloutType: "important"
            });
            const second = saveReadWeaveEntry({
                articleId: secondArticle.noteId,
                anchorId: "rw_anchor_b",
                anchorType: "paragraph",
                kind: "question",
                title: first.title,
                body: first.body,
                sourceExcerpt: "Second source paragraph.",
                calloutType: "note",
                reuseObjectId: first.objectId
            });

            expect(second.objectId).toBe(first.objectId);
            expect(getReadWeaveImpact(first.objectId)).toMatchObject({ linkCount: 2, articleCount: 2 });

            editReadWeaveLink(first.linkId, {
                mode: "global",
                title: first.title,
                body: professionalAnswer("全局修改更新规范对象内容"),
                calloutType: "warning"
            });
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_anchor_b")[0].body).toBe(professionalAnswer("全局修改更新规范对象内容"));

            editReadWeaveLink(second.linkId, {
                mode: "article-variant",
                title: first.title,
                body: professionalAnswer("文章 B 使用独立变体"),
                calloutType: "tip"
            });
            expect(getEntriesForAnchor(firstArticle.noteId, "rw_anchor_a")[0].body).toBe(professionalAnswer("全局修改更新规范对象内容"));
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_anchor_b")[0].body).toBe(professionalAnswer("文章 B 使用独立变体"));

            editReadWeaveLink(first.linkId, {
                mode: "display-only",
                title: "Local display title",
                body: professionalAnswer("本地显示覆盖只影响当前链接"),
                calloutType: "caution"
            });
            const local = getEntriesForAnchor(firstArticle.noteId, "rw_anchor_a")[0];
            expect(local.isDisplayOverride).toBe(true);
            expect(local.canonicalBody).toBe(professionalAnswer("全局修改更新规范对象内容"));
            expect(local.body).toBe(professionalAnswer("本地显示覆盖只影响当前链接"));
            expect(local.calloutType).toBe("caution");

            expect(getAnchorSummaries(firstArticle.noteId)).toMatchObject([ {
                anchorId: "rw_anchor_a",
                anchorType: "range",
                questionCount: 1,
                termCount: 0
            } ]);

            const exported = exportReadWeave(firstArticle.noteId);
            expect(exported.scope).toEqual({ type: "articles", articleIds: [ firstArticle.noteId ], includeContent: true });
            expect(exported.articles).toEqual([ { articleId: firstArticle.noteId, title: "ReadWeave test article A" } ]);
            expect(exported.anchors).toMatchObject([ { articleId: firstArticle.noteId, anchorId: "rw_anchor_a", excerpt: "First source paragraph." } ]);
            expect(exported.anchors[0].selector).toMatchObject({ type: "readweave-range-v1", quote: "First source paragraph." });
            expect(exported.links).toHaveLength(1);
            expect(exported.objects).toHaveLength(1);
            expect(exported.integrity).toMatchObject({ valid: true, articleCount: 1, anchorCount: 1, objectCount: 1, linkCount: 1 });
            expect(exported.integrity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(becca.getNote("_readweaveObjects")).not.toBeNull();
        });
    });

    it("deletes only the selected link and cleans up an object after its final link is removed", () => {
        cls.init(() => {
            const firstArticle = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave deletion article A",
                type: "text",
                mime: "text/html",
                content: "<p>Shared deletion source A.</p>"
            }).note;
            const secondArticle = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave deletion article B",
                type: "text",
                mime: "text/html",
                content: "<p>Shared deletion source B.</p>"
            }).note;
            const first = saveReadWeaveEntry({
                articleId: firstArticle.noteId,
                anchorId: "rw_delete_a",
                anchorType: "range",
                kind: "question",
                title: "共享对象删除时应发生什么？",
                body: professionalAnswer("删除当前片段时只解除当前链接，不影响其他文章中的共享内容"),
                sourceExcerpt: "Shared deletion source A.",
                calloutType: "note"
            });
            const second = saveReadWeaveEntry({
                articleId: secondArticle.noteId,
                anchorId: "rw_delete_b",
                anchorType: "range",
                kind: "question",
                title: first.title,
                body: first.body,
                sourceExcerpt: "Shared deletion source B.",
                calloutType: "note",
                reuseObjectId: first.objectId
            });

            expect(deleteReadWeaveLink(first.linkId)).toEqual({
                deleted: true,
                linkId: first.linkId,
                objectId: first.objectId,
                objectDeleted: false,
                remainingLinkCount: 1
            });
            expect(getEntriesForAnchor(firstArticle.noteId, "rw_delete_a")).toEqual([]);
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_delete_b")).toHaveLength(1);
            expect(getReadWeaveImpact(first.objectId)).toMatchObject({ linkCount: 1, articleCount: 1 });

            expect(deleteReadWeaveLink(second.linkId)).toEqual({
                deleted: true,
                linkId: second.linkId,
                objectId: second.objectId,
                objectDeleted: true,
                remainingLinkCount: 0
            });
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_delete_b")).toEqual([]);
            expect(becca.getNote(first.objectId)).toBeFalsy();
        });
    });

    it("allows multiple questions but only one definition per fragment while allowing nested definitions", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave definition cardinality",
                type: "text",
                mime: "text/html",
                content: "<p>NPU accelerates matrix operations.</p>"
            }).note;
            const base = {
                articleId: article.noteId,
                anchorId: "rw_cardinality_anchor",
                anchorType: "range" as const,
                sourceExcerpt: "NPU",
                calloutType: "tip" as const
            };

            saveReadWeaveEntry({
                ...base,
                kind: "question",
                title: "NPU 是什么？",
                body: professionalAnswer("NPU 神经网络处理单元（Neural Processing Unit）是专用硬件加速单元")
            });
            saveReadWeaveEntry({
                ...base,
                kind: "question",
                title: "NPU 如何加速矩阵运算？",
                body: professionalAnswer("NPU 神经网络处理单元（Neural Processing Unit）通过专用并行数据路径加速矩阵运算")
            });
            const definition = saveReadWeaveEntry({
                ...base,
                kind: "term",
                title: "NPU",
                body: professionalAnswer("NPU 神经网络处理单元（Neural Processing Unit）是面向神经网络计算的专用处理单元"),
                termIdentity: { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" }
            });

            expect(getAnchorSummaries(article.noteId)).toMatchObject([ {
                anchorId: base.anchorId,
                questionCount: 2,
                termCount: 1
            } ]);
            expect(saveReadWeaveEntry({
                ...base,
                kind: "term",
                title: definition.title,
                body: definition.body,
                termIdentity: definition.termIdentity,
                reuseObjectId: definition.objectId
            }).linkId).toBe(definition.linkId);
            expect(() => saveReadWeaveEntry({
                ...base,
                kind: "term",
                title: "NPU duplicate",
                body: professionalAnswer("NPU 神经网络处理单元（Neural Processing Unit）的重复定义不应被保存"),
                termIdentity: { abbreviation: "NPU", chineseName: "神经处理单元", englishName: "Neural Processing Unit" }
            })).toThrow(/already has a definition/);

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_nested_definition",
                sourceExcerpt: "matrix",
                kind: "term",
                title: "矩阵",
                body: professionalAnswer("矩阵（Matrix）是按行列组织的数值数组，用于表示线性变换和多维数据"),
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            })).not.toThrow();

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_nested_definition",
                sourceExcerpt: "matrix operations",
                kind: "term",
                title: "矩阵运算",
                body: professionalAnswer("矩阵运算（Matrix Operation）是作用于矩阵并产生标量、向量或矩阵结果的数学运算"),
                termIdentity: { chineseName: "矩阵运算", englishName: "Matrix Operation" }
            })).toThrow(/different text fragment/);
        });
    });

    it("applies a compact semantic save gate to definitions and keeps the canonical identity aligned with the body", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave definition quality gate",
                type: "text",
                mime: "text/html",
                content: "<p>Matrix and NPU terminology.</p>"
            }).note;
            const base = {
                articleId: article.noteId,
                anchorType: "range" as const,
                kind: "term" as const,
                calloutType: "tip" as const
            };

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_shallow_definition",
                sourceExcerpt: "Matrix",
                title: "矩阵",
                body: "矩阵（Matrix）是一种数学概念。",
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            })).toThrow(/定义过于简略|定义过于宽泛/);

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_circular_definition",
                sourceExcerpt: "Matrix",
                title: "矩阵",
                body: "矩阵（Matrix）就是矩阵（Matrix）；矩阵（Matrix）是一个常见、重要且应用广泛的数学对象，但这段文字没有给出任何可区分特征。",
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            })).toThrow(/同义反复/);

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_mismatched_identity",
                sourceExcerpt: "NPU",
                title: "NPU",
                body: "神经网络处理单元是一类面向神经网络计算的专用处理器；它通过并行乘加数据路径加速张量运算，并不等同于通用中央处理器。",
                termIdentity: { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" }
            })).toThrow(/未使用规范术语身份/);

            const saved = saveReadWeaveEntry({
                ...base,
                anchorId: "rw_compact_definition",
                sourceExcerpt: "Matrix",
                title: "矩阵",
                body: "矩阵（Matrix）是按行和列排列的矩形数表；它用于表示线性方程组、线性变换或多维数据，行数与列数共同限定其维度。",
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            });
            expect(saved).toMatchObject({
                kind: "term",
                title: "矩阵（Matrix）",
                body: expect.stringContaining("按行和列排列")
            });

            const tess = saveReadWeaveEntry({
                ...base,
                anchorId: "rw_tess_used_for_predicate",
                sourceExcerpt: "TESS",
                title: "TESS",
                body: "TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）用于通过恒星亮度的周期性下降寻找候选系外行星；",
                termIdentity: {
                    abbreviation: "TESS",
                    chineseName: "凌日系外行星巡天卫星",
                    englishName: "Transiting Exoplanet Survey Satellite"
                }
            });
            expect(tess.title).toBe("TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）");
        });
    });

    it("saves a canonical ORCID definition without treating ID inside its English name as a bare abbreviation", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave ORCID regression",
                type: "text",
                mime: "text/html",
                content: "<p>ORCID 0000-0002-2267-5282</p>"
            }).note;

            const saved = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_orcid",
                anchorType: "range",
                sourceExcerpt: "ORCID",
                kind: "term",
                title: "ORCID",
                body: "ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）是由全球性非营利组织运营的持久标识符系统；它为研究人员分配唯一的 16 位标识符，以消除姓名歧义并关联学术产出；",
                calloutType: "tip",
                termIdentity: {
                    abbreviation: "ORCID",
                    chineseName: "开放研究者与贡献者标识符",
                    englishName: "Open Researcher and Contributor ID"
                }
            });

            expect(saved).toMatchObject({
                kind: "term",
                title: "ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）"
            });
        });
    });

    it("requires and persists the evidence-plan attestation when saving a non-expandable MAVERICK method", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave non-expandable method save gate",
                type: "text",
                mime: "text/html",
                content: "<p>MAVERICK is a placement method name.</p>"
            }).note;
            const title = "MAVERICK 在当前布局语境中是什么方法？";
            const body = "MAVERICK 是一种面向芯片元件位置约束的布局优化方法；它通过分析候选位置之间的冲突来调整元件分布，并把适用边界限制在资料明确描述的布局任务。";
            const verifiedNonExpandableArtifact = { originalName: "MAVERICK", entityType: "method" as const };

            const saved = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_maverick_verified",
                anchorType: "range",
                sourceExcerpt: "MAVERICK",
                kind: "question",
                title,
                body,
                calloutType: "note",
                verifiedNonExpandableArtifact
            });

            expect(saved.verifiedNonExpandableArtifact).toEqual(verifiedNonExpandableArtifact);
            expect(saved.body).toContain("MAVERICK 是一种");
            expect(() => saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_maverick_unverified",
                anchorType: "range",
                sourceExcerpt: "MAVERICK method",
                kind: "question",
                title,
                body,
                calloutType: "note"
            })).toThrow(/缩写 MAVERICK/);
            expect(() => saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_maverick_wrong_subject",
                anchorType: "range",
                sourceExcerpt: "other method",
                kind: "question",
                title: "另一个布局方法是什么？",
                body,
                calloutType: "note",
                verifiedNonExpandableArtifact
            })).toThrow(/exactly match the current title or subject/);
        });
    });

    it("uses the extracted question subject when rechecking a generated answer during save", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave generated question save parity",
                type: "text",
                mime: "text/html",
                content: "<p>BS-PDN-Last</p>"
            }).note;

            const saved = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_bs_pdn_last_question",
                anchorType: "range",
                sourceExcerpt: "BS-PDN-Last:",
                kind: "question",
                title: "BS-PDN-Last是什么",
                body: "BS-PDN-Last 是一种面向具有多功能背面金属层的最优电源分配网络设计方法；它以具有多功能背面金属层为设计对象，核心目标是优化电源分配网络结构；其适用范围是采用具有多功能背面金属层的供电网络设计问题，不等同于电源分配网络这一通用概念；该名称是方法原名，不是可展开的英文缩写",
                calloutType: "note",
                verifiedNonExpandableArtifact: {
                    originalName: "BS-PDN-Last",
                    entityType: "method"
                }
            });

            expect(saved).toMatchObject({
                kind: "question",
                title: "BS-PDN-Last是什么",
                body: expect.stringContaining("BS-PDN-Last")
            });
        });
    });

    it("rejects a method name masquerading as both its abbreviation and English expansion", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave malformed term identity",
                type: "text",
                mime: "text/html",
                content: "<p>BS-PDN-Last</p>"
            }).note;

            expect(() => saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_bs_pdn_last",
                anchorType: "range",
                sourceExcerpt: "BS-PDN-Last",
                kind: "term",
                title: "BS-PDN-Last",
                body: "BS-PDN-Last 是一种面向背面金属层的电源分配网络设计方法；",
                calloutType: "tip",
                termIdentity: {
                    abbreviation: "BS-PDN-Last",
                    chineseName: "BS-PDN-Last 电源分配网络设计方法",
                    englishName: "BS-PDN-Last"
                }
            })).toThrow(/English full name must expand the abbreviation/);
        });
    });
});
