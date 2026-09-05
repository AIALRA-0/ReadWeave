export interface ReadWeaveLocalReplacement {
    body: string;
    selectedText: string;
    replacement: string;
    start: number;
    end: number;
}
/** Apply a server-approved replacement without allowing text outside the range to change. */
export function applyReadWeaveLocalReplacement(input: ReadWeaveLocalReplacement): string {
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end)
        || input.start < 0 || input.end <= input.start || input.end > input.body.length) {
        throw new Error("局部修改范围无效");
    }
    if (input.body.slice(input.start, input.end) !== input.selectedText) {
        throw new Error("回答内容已经变化，局部修改未应用");
    }
    if (!input.replacement || input.replacement.includes("\n\n")) {
        throw new Error("局部修改返回了整段内容");
    }
    return `${input.body.slice(0, input.start)}${input.replacement}${input.body.slice(input.end)}`;
}
