import type { ReadWeaveGenerationAudit } from "@triliumnext/commons";
import { becca, cls, hidden_subtree as hiddenSubtreeService, note_service as noteService } from "@triliumnext/core";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
    deleteReadWeaveLink,
    editReadWeaveLink,
    exportReadWeave,
    getAnchorSummaries,
    getEntriesForAnchor,
    getReadWeaveImpact,
    getReadWeaveObject,
    saveReadWeaveEntry,
    validateReadWeaveFollowUp
} from "./readweave_repository.js";
import sqlInit from "./sql_init.js";
import { captureReadWeaveTask } from "./readweave_task_contract.js";

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
            expect(first.qualityState).toBe("legacy-unverified");
            expect(second.qualityState).toBe("legacy-unverified");
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

    it.each(["article", "all"] as const)("strips only server task contracts from %s exports of reused and revised objects", scope => {
        cls.init(() => {
            const sentinel = `PRIVATE_ARTICLE_A_CONTEXT_${scope}`;
            const firstArticle = noteService.createNewNote({
                parentNoteId: "root", title: "Portable source A", type: "text", mime: "text/html",
                content: `<p>Public selection.</p><p>${sentinel}</p>`
            }).note;
            const secondArticle = noteService.createNewNote({
                parentNoteId: "root", title: "Portable destination B", type: "text", mime: "text/html",
                content: "<p>Destination selection.</p>"
            }).note;
            const taskContract = captureReadWeaveTask({
                articleId: firstArticle.noteId, anchorId: "portable_a", anchorType: "range", kind: "question",
                title: "Explain the public selection.", fragments: [
                    { id: "selection", role: "selected", text: "Public selection." },
                    { id: "article", role: "document", text: sentinel }
                ]
            }, false);
            const publicAudit: ReadWeaveGenerationAudit = {
                workflowVersion: "unified-evidence-v1",
                questionContract: {
                    normalizedQuestion: "Explain the public selection.", objective: "Explain it",
                    answerRequirements: ["Keep the answer"], exclusions: [], searchQueries: [], requiresCurrentEvidence: false
                },
                searchQueries: [], unresolvedClaims: [], validationIssues: [], citationsVerified: false,
                generatedAt: "2026-01-01T00:00:00.000Z"
            };
            const privateAudit = { ...publicAudit, questionContract: { ...publicAudit.questionContract, taskContract } };
            // Retained/legacy extensions can nest audits in candidates and revisions.
            // Answer strings mentioning the reserved field are legitimate user content.
            const candidateBody = 'The JSON field "taskContract" is discussed in this answer.';
            const audit = {
                ...privateAudit,
                candidates: [{ body: candidateBody, audit: privateAudit }],
                revisions: [{ revision: 0, body: "Keep the previous answer.", candidateAudit: privateAudit }]
            };
            const portableAudit = {
                ...publicAudit,
                candidates: [{ body: candidateBody, audit: publicAudit }],
                revisions: [{ revision: 0, body: "Keep the previous answer.", candidateAudit: publicAudit }]
            };
            const first = saveReadWeaveEntry({
                articleId: firstArticle.noteId, anchorId: "portable_a", anchorType: "range", kind: "question",
                title: "Explain the public selection.", body: "Keep the original answer.", sourceExcerpt: "Public selection.",
                calloutType: "note", audit,
                evidenceSources: [{ sourceId: "S1", sourceType: "local", provider: "article", title: "Public evidence",
                    excerpt: "Public selection.", accessedAt: publicAudit.generatedAt }],
                claims: [{ claimId: "C1", text: "Keep this claim.", sourceIds: ["S1"], confidence: "high" }]
            });
            const second = saveReadWeaveEntry({
                articleId: secondArticle.noteId, anchorId: "portable_b", anchorType: "range", kind: "question",
                title: first.title, body: first.body, sourceExcerpt: "Destination selection.", calloutType: "note",
                reuseObjectId: first.objectId
            });
            expect(second.objectId).toBe(first.objectId);
            const objectNote = becca.getNoteOrThrow(first.objectId);
            const exportCurrent = (expectedAudit: typeof portableAudit) => {
                const savedBefore = objectNote.getContent();
                const revisionsBefore = objectNote.getRevisions().map(revision => revision.getContent());
                const recordBefore = getReadWeaveObject(first.objectId);
                const exported = exportReadWeave(scope === "article" ? secondArticle.noteId : undefined);
                const portableObject = exported.objects.find(object => object.objectId === first.objectId)!;
                expect(JSON.stringify(exported)).not.toContain(sentinel);
                expect(portableObject).toEqual({ ...recordBefore, audit: expectedAudit });
                expect(exported.links.find(link => link.linkId === second.linkId)?.objectId).toBe(first.objectId);
                expect(exported.integrity.valid).toBe(true);
                const { articles, anchors, objects, links } = exported;
                expect(exported.integrity.contentSha256).toBe(createHash("sha256")
                    .update(JSON.stringify({ articles, anchors, objects, links })).digest("hex"));
                expect(objectNote.getContent()).toBe(savedBefore);
                expect(objectNote.getRevisions().map(revision => revision.getContent())).toEqual(revisionsBefore);
                expect(getReadWeaveObject(first.objectId)).toEqual(recordBefore);
                expect(recordBefore.audit?.questionContract.taskContract).toEqual(taskContract);
                expect(first.audit).toEqual(audit);
            };
            exportCurrent(portableAudit);
            const storedRevision = objectNote.saveRevision();
            expect(storedRevision.getContent()).toContain(sentinel);
            editReadWeaveLink(first.linkId, {
                mode: "global", title: first.title, body: "Keep the revised answer.", calloutType: "note"
            });
            expect(getReadWeaveObject(first.objectId).revision).toBe(2);
            exportCurrent({ ...portableAudit, manuallyEdited: true });
        });
    });

    it("round-trips generated and manual content types without changing the legacy kind", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave content type article",
                type: "text",
                mime: "text/html",
                content: "<p>Content type source.</p>"
            }).note;
            const manualNote = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_content_note",
                anchorType: "range",
                kind: "question",
                contentType: "note",
                origin: "manual",
                title: "阅读笔记",
                body: "这是用户手写的旁路笔记",
                sourceExcerpt: "Content type source.",
                calloutType: "warning"
            });
            const definition = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_content_definition",
                anchorType: "range",
                kind: "term",
                title: "NPU",
                body: "NPU 神经网络处理单元（Neural Processing Unit）是专用处理单元",
                sourceExcerpt: "Content type source.",
                calloutType: "tip",
                termIdentity: { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" }
            });
            expect(manualNote.kind).toBe("question");
            expect(manualNote.contentType).toBe("note");
            expect(manualNote.origin).toBe("manual");
            expect(definition.contentType).toBe("definition");
            expect(definition.origin).toBe("generated");
            expect(getAnchorSummaries(article.noteId).flatMap(summary => summary.contentTypes ?? [])).toEqual([ "definition", "note" ]);
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
                remainingLinkCount: 1,
                deletedLinkIds: [ first.linkId ],
                promotedLinkIds: []
            });
            expect(getEntriesForAnchor(firstArticle.noteId, "rw_delete_a")).toEqual([]);
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_delete_b")).toHaveLength(1);
            expect(getReadWeaveImpact(first.objectId)).toMatchObject({ linkCount: 1, articleCount: 1 });

            expect(deleteReadWeaveLink(second.linkId)).toEqual({
                deleted: true,
                linkId: second.linkId,
                objectId: second.objectId,
                objectDeleted: true,
                remainingLinkCount: 0,
                deletedLinkIds: [ second.linkId ],
                promotedLinkIds: []
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

    it("preserves reviewed manual edits without replaying obsolete generator regex gates and keeps canonical identity aligned", () => {
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

            const manuallyReviewed = saveReadWeaveEntry({
                ...base,
                anchorId: "rw_shallow_definition",
                sourceExcerpt: "Matrix",
                title: "矩阵",
                body: "矩阵（Matrix）是一种数学概念。",
                termIdentity: { chineseName: "矩阵", englishName: "Matrix" }
            });
            expect(manuallyReviewed.title).toBe("矩阵（Matrix）");

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

    it("persists evidence, claim mappings and the unified audit with the saved answer", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave unified provenance",
                type: "text",
                mime: "text/html",
                content: "<p>Evidence-backed answer</p>"
            }).note;
            const generatedAt = new Date().toISOString();
            const saved = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_provenance",
                anchorType: "range",
                sourceExcerpt: "Evidence-backed answer",
                kind: "question",
                title: "该结论的依据是什么？",
                body: "该结论由公开资料直接支持",
                calloutType: "note",
                evidenceSources: [ {
                    sourceId: "S1",
                    sourceType: "external",
                    provider: "Official",
                    title: "Official source",
                    url: "https://example.org/source",
                    excerpt: "Direct evidence",
                    accessedAt: generatedAt
                } ],
                claims: [ { claimId: "C1", text: "该结论由公开资料支持", sourceIds: [ "S1" ], confidence: "high" } ],
                audit: {
                    workflowVersion: "unified-evidence-v1",
                    questionContract: {
                        normalizedQuestion: "该结论的依据是什么？",
                        objective: "说明依据",
                        answerRequirements: [ "给出直接证据" ],
                        exclusions: [],
                        searchQueries: [ "direct evidence" ],
                        requiresCurrentEvidence: true
                    },
                    searchQueries: [ "direct evidence" ],
                    unresolvedClaims: [],
                    validationIssues: [],
                    citationsVerified: true,
                    generatedAt
                }
            });

            expect(saved.evidenceSources?.[0]).toMatchObject({ sourceId: "S1", title: "Official source" });
            expect(saved.claims?.[0]).toMatchObject({ claimId: "C1", sourceIds: [ "S1" ] });
            expect(saved.audit?.workflowVersion).toBe("unified-evidence-v1");
            // Older audits have no taskContract: keep their complete portable shape.
            expect(exportReadWeave(article.noteId).objects).toEqual([getReadWeaveObject(saved.objectId)]);
        });
    });

    it("persists optional evidence-plan attestation without blocking a reviewed manual answer", () => {
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
            const manuallyReviewed = saveReadWeaveEntry({
                articleId: article.noteId,
                anchorId: "rw_maverick_unverified",
                anchorType: "range",
                sourceExcerpt: "MAVERICK method",
                kind: "question",
                title,
                body,
                calloutType: "note"
            });
            expect(manuallyReviewed.body).toContain("MAVERICK 是一种");
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

    it("persists a three-level follow-up tree, detects stale parents and cascades descendants", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave follow-up tree",
                type: "text",
                mime: "text/html",
                content: "<p>A transistor controls current.</p>"
            }).note;
            const base = {
                articleId: article.noteId,
                anchorId: "rw_follow_up_tree",
                anchorType: "range" as const,
                sourceExcerpt: "transistor",
                kind: "question" as const,
                calloutType: "note" as const
            };
            const root = saveReadWeaveEntry({
                ...base,
                title: "晶体管是什么？",
                body: professionalAnswer("晶体管是一种用电信号控制电流通断或大小的半导体器件")
            });
            const levels = [ root ];
            for (let depth = 1; depth <= 3; depth += 1) {
                levels.push(saveReadWeaveEntry({
                    ...base,
                    parentLinkId: levels.at(-1)!.linkId,
                    title: `第 ${depth} 层追问如何理解？`,
                    body: professionalAnswer(`第 ${depth} 层答案从父问题的结论继续解释控制关系`)
                }));
            }

            expect(levels.map(entry => entry.depth)).toEqual([ 0, 1, 2, 3 ]);
            expect(levels.slice(1).every(entry => entry.rootLinkId === root.linkId)).toBe(true);
            expect(() => saveReadWeaveEntry({
                ...base,
                parentLinkId: levels.at(-1)!.linkId,
                title: "第四层追问为什么不允许？",
                body: professionalAnswer("第四层超过允许的追问深度")
            })).toThrow(/最多三层/);

            editReadWeaveLink(root.linkId, {
                mode: "global",
                title: root.title,
                body: professionalAnswer("晶体管是一种用电信号控制电流的半导体器件；父答案经过审核更新后，子问题应明确标记所依据的父版本已经变化"),
                calloutType: "note"
            });
            expect(getEntriesForAnchor(article.noteId, base.anchorId)
                .find(entry => entry.linkId === levels[1].linkId)).toMatchObject({
                parentLinkId: root.linkId,
                parentStale: true
            });

            const deletion = deleteReadWeaveLink(levels[2].linkId, "cascade");
            expect(deletion.deletedLinkIds).toEqual(levels.slice(2).map(entry => entry.linkId));
            expect(deletion.promotedLinkIds).toEqual([]);
            expect(getEntriesForAnchor(article.noteId, base.anchorId).map(entry => entry.linkId))
                .toEqual(expect.arrayContaining([ root.linkId, levels[1].linkId ]));
            expect(getEntriesForAnchor(article.noteId, base.anchorId)).toHaveLength(2);
        });
    });
    it("supplies the complete saved parent chain and article to follow-up generation", () => {
        cls.init(() => {
            const articleText=`<p>${"article context ".repeat(7000)}ARTICLE_TAIL</p>`;
            const article=noteService.createNewNote({parentNoteId:"root",title:"Full follow-up context",type:"text",mime:"text/html",content:articleText}).note;
            const base={articleId:article.noteId,anchorId:"full_follow_up",anchorType:"range" as const,sourceExcerpt:"article",kind:"question" as const,calloutType:"note" as const};
            const root=saveReadWeaveEntry({...base,title:"根问题",body:professionalAnswer("根回答")});
            const parent=saveReadWeaveEntry({...base,parentLinkId:root.linkId,title:"父问题",body:`开始${"完整父回答".repeat(1500)}PARENT_TAIL`});
            const request:import("@triliumnext/commons").ReadWeaveGenerateRequest={...base,parentLinkId:parent.linkId,title:"开始是什么？",
                answerSelection:{parentRevision:parent.revision,startOffset:0,endOffset:2,text:"开始"},
                fragments:[{id:"forged-parent",role:"previous",text:"untrusted replacement"}]};
            validateReadWeaveFollowUp(request);
            expect(request.fragments.find(item=>item.id==="parent-answer")?.text).toBe(parent.body);
            expect(request.fragments.find(item=>item.id===`ancestor-${root.linkId}`)?.text).toBe(root.body);
            expect(request.fragments.find(item=>item.id==="document")?.text).toBe(articleText);
            expect(request.fragments.some(item=>item.id==="forged-parent")).toBe(false);
        });
    });

    it("saves every answer action under the exact saved parent selection", () => {
        cls.init(() => {
            const article = noteService.createNewNote({ parentNoteId: "root", title: "Follow-up actions",
                type: "text", mime: "text/html", content: "<p>A circuit has components.</p>" }).note;
            const base = { articleId: article.noteId, anchorId: "rw_follow_up_actions",
                anchorType: "range" as const, sourceExcerpt: "circuit", calloutType: "note" as const };
            const parent = saveReadWeaveEntry({ ...base, kind: "question", contentType: "problem",
                title: "电路是什么？", body: professionalAnswer("电路由导电路径和元件构成") });
            const selection = { parentRevision: parent.revision, startOffset: 0, endOffset: 2,
                text: parent.body.slice(0, 2) };
            for (const [ contentType, kind ] of [
                [ "problem", "question" ], [ "definition", "term" ],
                [ "annotation", "question" ], [ "key-point", "question" ], [ "note", "question" ]
            ] as const) {
                const child = saveReadWeaveEntry({ ...base, kind, contentType,
                    parentLinkId: parent.linkId, answerSelection: selection,
                    title: `${contentType} 子内容`, body: professionalAnswer(`${contentType} 的子内容解释`) });
                expect(child).toMatchObject({ parentLinkId: parent.linkId, depth: 1,
                    answerSelection: selection, contentType });
            }
            expect(() => saveReadWeaveEntry({ ...base, kind: "question", contentType: "problem",
                parentLinkId: parent.linkId, answerSelection: { ...selection, text: "错字" },
                title: "错误选区", body: professionalAnswer("不应保存错误选区") })).toThrow(/父回答或选中文字已变化/);
        });
    });

    it("can promote follow-up children when deleting their parent question", () => {
        cls.init(() => {
            const article = noteService.createNewNote({
                parentNoteId: "root",
                title: "ReadWeave follow-up promotion",
                type: "text",
                mime: "text/html",
                content: "<p>A cache stores reusable data.</p>"
            }).note;
            const base = {
                articleId: article.noteId,
                anchorId: "rw_follow_up_promote",
                anchorType: "range" as const,
                sourceExcerpt: "cache",
                kind: "question" as const,
                calloutType: "note" as const
            };
            const root = saveReadWeaveEntry({
                ...base,
                title: "缓存是什么？",
                body: professionalAnswer("缓存把近期或常用数据放在更快的存储层以减少重复访问延迟")
            });
            const child = saveReadWeaveEntry({
                ...base,
                parentLinkId: root.linkId,
                title: "为什么缓存能减少延迟？",
                body: professionalAnswer("缓存命中时可以跳过更慢的下层数据访问")
            });
            const grandchild = saveReadWeaveEntry({
                ...base,
                parentLinkId: child.linkId,
                title: "缓存未命中时会发生什么？",
                body: professionalAnswer("缓存未命中时需要访问下层存储并按策略把结果写回缓存")
            });

            const deletion = deleteReadWeaveLink(child.linkId, "promote");
            expect(deletion).toMatchObject({
                deletedLinkIds: [ child.linkId ],
                promotedLinkIds: [ grandchild.linkId ]
            });
            expect(getEntriesForAnchor(article.noteId, base.anchorId)
                .find(entry => entry.linkId === grandchild.linkId)).toMatchObject({
                parentLinkId: root.linkId,
                rootLinkId: root.linkId,
                depth: 1
            });
            expect(getEntriesForAnchor(article.noteId, base.anchorId)
                .find(entry => entry.linkId === grandchild.linkId)?.parentStale).not.toBe(true);
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
