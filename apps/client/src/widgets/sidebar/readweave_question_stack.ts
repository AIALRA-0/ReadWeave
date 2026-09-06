import type { ReadWeaveQuestionItem } from "@triliumnext/commons";

export function readWeaveQuestionStackFromText(value: string): ReadWeaveQuestionItem[] {
    return value
        .split(/\r?\n/gu)
        .map(text => text.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((text, index) => ({ id: `question-${index + 1}`, text }));
}

export function insertOrReplaceReadWeaveQuestion(
    current: string,
    replacement: string,
    caret = current.length
): string {
    const nextQuestion = replacement.trim();
    if (!current.trim()) return nextQuestion;
    if (caret >= current.length) return `${current.replace(/\s+$/u, "")}\n${nextQuestion}`;
    const lineStart = current.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const lineEnd = current.indexOf("\n", caret);
    const end = lineEnd < 0 ? current.length : lineEnd;
    return `${current.slice(0, lineStart)}${nextQuestion}${current.slice(end)}`;
}
