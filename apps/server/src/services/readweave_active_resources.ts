import { createHash } from "node:crypto";
import type { ReadWeaveContextFragment, ReadWeaveEvidenceSource } from "@triliumnext/commons";

export type ArticleRead =
    | { tool: "fragment"; ids: string[] }
    | { tool: "neighbors"; id: string; radius: number }
    | { tool: "section"; id: string }
    | { tool: "article" }
    | { tool: "find"; text: string };

/** Per-generation address space. No prefix truncation, shared article state or hidden ranking. */
export class ReadWeaveActiveResources {
    private readonly fragments: ReadWeaveContextFragment[];
    private readonly sources = new Map<string, ReadWeaveEvidenceSource>();
    private readonly textIds = new Map<string, string>();
    private readonly externalIds = new Map<string, string>();
    private readonly documentSections = new Map<string, string[]>();
    readonly opened = new Set<string>();
    readonly everOpened = new Set<string>();
    readonly trace: Array<{ tool: string; sourceIds: string[]; newSourceIds: string[] }> = [];

    constructor(fragments: ReadWeaveContextFragment[]) {
        this.fragments = structuredClone(fragments);
        if (new Set(fragments.map(f => f.id)).size !== fragments.length) throw new Error("文章片段标识重复");
        for (const f of this.fragments) this.sources.set(f.id, {
            sourceId: f.id, sourceType: "local", provider: "article", title: f.role,
            excerpt: f.text, accessedAt: new Date().toISOString()
        });
    }

    snapshot() {
        return { sources: [...this.sources.values()], externalIds: [...this.externalIds],
            documentSections: [...this.documentSections], opened: [...this.opened], everOpened: [...this.everOpened], trace: this.trace };
    }

    restore(snapshot: ReturnType<ReadWeaveActiveResources["snapshot"]>) {
        for (const source of snapshot.sources) this.sources.set(source.sourceId, structuredClone(source));
        for (const [key, value] of snapshot.externalIds) this.externalIds.set(key, value);
        for (const [key, value] of snapshot.documentSections) this.documentSections.set(key, value);
        this.open(snapshot.opened, "restore");
        for (const id of snapshot.everOpened) this.everOpened.add(id);
        this.trace.splice(0, this.trace.length, ...structuredClone(snapshot.trace));
    }

    catalog() {
        const positions = new Map(this.fragments.map(f => [f.id, f]));
        return [...this.sources.values()].map(({ sourceId, sourceType, title, url, excerpt }) => ({
            id: sourceId, type: sourceType, title, url, characters: excerpt.length, opened: this.opened.has(sourceId),
            documentBlockId:positions.get(sourceId)?.documentBlockId, headingLevel:positions.get(sourceId)?.headingLevel
        }));
    }

    get(id: string): ReadWeaveEvidenceSource {
        const source = this.sources.get(id);
        if (!source) throw new Error(`资料标识不存在：${id}`);
        return source;
    }

    addExternal(source: Omit<ReadWeaveEvidenceSource, "sourceId">): string {
        const digest = createHash("sha256").update(`${source.url ?? ""}\n${source.excerpt}`).digest("hex");
        let id = this.externalIds.get(digest);
        if (!id) {
            let sequence = this.externalIds.size + 1;
            do { id = `web-${sequence++}`; } while (this.sources.has(id));
        }
        this.externalIds.set(digest, id);
        if (!this.sources.has(id)) this.sources.set(id, { ...source, sourceId: id });
        return id;
    }

    /** Keep the complete page addressable, expose its complete section index first.
     * Reading a URL must not automatically stuff a long manual into the model context. */
    addDocument(source: Omit<ReadWeaveEvidenceSource, "sourceId">) {
        const sourceId = this.addExternal(source);
        let parts = source.excerpt.split(/(?=^#{1,6}\s)/gmu).filter(p => p.trim());
        if (parts.length < 2) parts = source.excerpt.split(/\n\s*\n/gu).filter(p => p.trim());
        const sections = parts.map((excerpt, index) => this.addExternal({ ...source,
            title: excerpt.match(/^#{1,6}\s+(.+)/u)?.[1] ?? `${source.title} · 段落 ${index + 1}`, excerpt }));
        this.documentSections.set(sourceId, sections);
        return { sourceId, sections: sections.map(id => ({id, title:this.get(id).title, characters:this.get(id).excerpt.length})) };
    }

    open(ids: string[], tool = "fragment") {
        const fresh: string[] = [];
        for (const id of new Set(ids)) {
            const source = this.get(id);
            const hash = createHash("sha256").update(source.excerpt).digest("hex");
            if (!this.opened.has(id) && !this.textIds.has(hash)) fresh.push(id);
            this.textIds.set(hash, this.textIds.get(hash) ?? id);
            this.opened.add(id);
            this.everOpened.add(id);
        }
        this.trace.push({ tool, sourceIds: [...new Set(ids)], newSourceIds: fresh });
        return { sourceIds: [...new Set(ids)], newSourceIds: fresh };
    }

    /** Each distinct text appears once, with aliases retaining complete provenance. */
    contents() {
        const groups = new Map<string, { sourceIds: string[]; text: string }>();
        for (const id of this.opened) {
            const source = this.get(id);
            const hash = createHash("sha256").update(source.excerpt).digest("hex");
            const group = groups.get(hash) ?? { sourceIds: [], text: source.excerpt };
            group.sourceIds.push(id);
            groups.set(hash, group);
        }
        return [...groups.values()];
    }

    release(ids: string[]) {
        for (const id of ids) { this.get(id); this.opened.delete(id); }
        // Content remains in the address space and can always be read again.
        this.textIds.clear();
        for (const id of this.opened) this.textIds.set(createHash("sha256").update(this.get(id).excerpt).digest("hex"), id);
    }

    read(action: ArticleRead) {
        if (action.tool === "fragment") return this.open(action.ids);
        if (action.tool === "find") {
            if (!action.text.trim()) throw new Error("文章检索词不能为空");
            const ids = [...this.sources.values()]
                .filter(s => !this.documentSections.has(s.sourceId) && s.excerpt.toLocaleLowerCase().includes(action.text.toLocaleLowerCase()))
                .map(s => s.sourceId);
            this.trace.push({ tool: "find", sourceIds: ids, newSourceIds: [] });
            return { sourceIds: ids, newSourceIds: [] };
        }
        if (action.tool === "article") return this.open(this.fragments.map(f => f.id), "article");
        const reference = this.fragments.find(f => f.id === action.id);
        const documents = this.fragments.filter(f => f.id.startsWith("document-block-"));
        const ordered = documents.length ? documents : this.fragments;
        const index = ordered.findIndex(f => f.id === (reference?.documentBlockId ?? action.id));
        if (index < 0) throw new Error("文章定位标识不存在");
        if (action.tool === "neighbors") {
            if (!Number.isSafeInteger(action.radius) || action.radius < 1) throw new Error("相邻范围必须为正整数");
            return this.open(ordered.filter((_, i) => Math.abs(i - index) <= action.radius).map(f => f.id), "neighbors");
        }
        let start = index, end = index + 1;
        while (start > 0 && ordered[start].role !== "heading") start--;
        const level = ordered[start].headingLevel ?? 6;
        while (end < ordered.length && !(ordered[end].role === "heading" && (ordered[end].headingLevel ?? 6) <= level)) end++;
        return this.open(ordered.filter((_, i) => i >= start && i < end).map(f => f.id), "section");
    }

    allOpenedSources() { return [...this.opened].map(id => this.get(id)); }
}
