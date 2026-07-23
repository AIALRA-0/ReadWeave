import { becca, cls, hidden_subtree as hiddenSubtreeService, note_service as noteService } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
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
                body: professionalAnswer("矩阵是按行列组织的数值数组"),
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            })).not.toThrow();

            expect(() => saveReadWeaveEntry({
                ...base,
                anchorId: "rw_nested_definition",
                sourceExcerpt: "matrix operations",
                kind: "term",
                title: "矩阵运算",
                body: professionalAnswer("矩阵运算是作用于矩阵的数学运算"),
                termIdentity: { chineseName: "矩阵运算", englishName: "Matrix Operation" }
            })).toThrow(/different text fragment/);
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
