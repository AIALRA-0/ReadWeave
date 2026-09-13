import "mind-elixir/style";

import type { MindElixirData, MindElixirInstance } from "mind-elixir";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";

import type { ReadWeaveMapNode } from "./readweave_chapter_map.js";

export function ReadWeaveChapterMap({ tree, onClose, onOpenEntry }: {
    tree: ReadWeaveMapNode;
    onClose: () => void;
    onOpenEntry: (linkId: string) => void;
}) {
    const canvas = useRef<HTMLDivElement>(null);
    const instance = useRef<MindElixirInstance>();
    useEffect(() => {
        let cancelled = false;
        void import("mind-elixir").then(({ default: MindElixir, DARK_THEME, THEME }) => {
            if (cancelled || !canvas.current) return;
            const mind = new MindElixir({
                el: canvas.current,
                editable: false,
                contextMenu: false,
                toolBar: true,
                theme: document.documentElement.dataset.theme === "dark" ? DARK_THEME : THEME
            });
            instance.current = mind;
            mind.init({ nodeData: tree } as MindElixirData);
            mind.bus.addListener("selectNodes", nodes => {
                const id = nodes.length === 1 ? nodes[0].id : "";
                if (id.startsWith("entry:")) onOpenEntry(id.slice(6));
            });
        });
        return () => { cancelled = true; instance.current?.destroy(); instance.current = undefined; };
    }, []);
    useEffect(() => {
        instance.current?.refresh({ nodeData: tree } as MindElixirData);
    }, [tree]);
    return createPortal(
        <div class="readweave-map-backdrop" role="presentation" onPointerDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section class="readweave-chapter-map" role="dialog" aria-modal="true" aria-label="文章章节思维导图"
                onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
                <header><strong>文章章节思维导图</strong><button type="button" class="btn btn-sm" onClick={onClose} aria-label="关闭思维导图">×</button></header>
                <div ref={canvas} class="readweave-chapter-map-canvas" data-testid="readweave-chapter-map-canvas" />
            </section>
        </div>, document.body
    );
}
