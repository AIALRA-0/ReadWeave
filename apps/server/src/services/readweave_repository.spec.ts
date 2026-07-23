import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import cls from "./cls.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import noteService from "./notes.js";
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
});
