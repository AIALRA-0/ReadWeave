import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import cls from "./cls.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import noteService from "./notes.js";
import {
    editReadWeaveLink,
    exportReadWeave,
    getEntriesForAnchor,
    getReadWeaveImpact,
    saveReadWeaveEntry
} from "./readweave_repository.js";
import sqlInit from "./sql_init.js";

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
                kind: "question",
                title: "What is an identifier link?",
                body: "It resolves content through an immutable object identifier.",
                sourceExcerpt: "First source paragraph."
            });
            const second = saveReadWeaveEntry({
                articleId: secondArticle.noteId,
                anchorId: "rw_anchor_b",
                kind: "question",
                title: first.title,
                body: first.body,
                sourceExcerpt: "Second source paragraph.",
                reuseObjectId: first.objectId
            });

            expect(second.objectId).toBe(first.objectId);
            expect(getReadWeaveImpact(first.objectId)).toMatchObject({ linkCount: 2, articleCount: 2 });

            editReadWeaveLink(first.linkId, {
                mode: "global",
                title: first.title,
                body: "Globally updated answer."
            });
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_anchor_b")[0].body).toBe("Globally updated answer.");

            editReadWeaveLink(second.linkId, {
                mode: "article-variant",
                title: first.title,
                body: "Article B variant."
            });
            expect(getEntriesForAnchor(firstArticle.noteId, "rw_anchor_a")[0].body).toBe("Globally updated answer.");
            expect(getEntriesForAnchor(secondArticle.noteId, "rw_anchor_b")[0].body).toBe("Article B variant.");

            editReadWeaveLink(first.linkId, {
                mode: "display-only",
                title: "Local display title",
                body: "Local display answer."
            });
            const local = getEntriesForAnchor(firstArticle.noteId, "rw_anchor_a")[0];
            expect(local.isDisplayOverride).toBe(true);
            expect(local.canonicalBody).toBe("Globally updated answer.");
            expect(local.body).toBe("Local display answer.");

            const exported = exportReadWeave(firstArticle.noteId);
            expect(exported.scope).toEqual({ type: "articles", articleIds: [ firstArticle.noteId ], includeContent: true });
            expect(exported.articles).toEqual([{ articleId: firstArticle.noteId, title: "ReadWeave test article A" }]);
            expect(exported.anchors).toMatchObject([{ articleId: firstArticle.noteId, anchorId: "rw_anchor_a", excerpt: "First source paragraph." }]);
            expect(exported.links).toHaveLength(1);
            expect(exported.objects).toHaveLength(1);
            expect(exported.integrity).toMatchObject({ valid: true, articleCount: 1, anchorCount: 1, objectCount: 1, linkCount: 1 });
            expect(exported.integrity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(becca.getNote("_readweaveObjects")).not.toBeNull();
        });
    });
});
