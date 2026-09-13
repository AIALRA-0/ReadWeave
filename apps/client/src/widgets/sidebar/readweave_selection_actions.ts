import { readWeaveKindForContentType, type ReadWeaveContentType } from "@triliumnext/commons";

export const READWEAVE_SELECTION_ACTIONS: Array<{ contentType: ReadWeaveContentType; label: string; icon: string }> = [
    { contentType: "problem", label: "提问", icon: "bx bx-message-square-add" },
    { contentType: "definition", label: "定义", icon: "bx bx-book-open" },
    { contentType: "annotation", label: "注解", icon: "bx bx-comment-dots" },
    { contentType: "key-point", label: "总结", icon: "bx bx-list-ul" },
    { contentType: "note", label: "笔记", icon: "bx bx-note" }
];

export function readWeaveSelectionActionKind(contentType: ReadWeaveContentType) {
    return readWeaveKindForContentType(contentType);
}
