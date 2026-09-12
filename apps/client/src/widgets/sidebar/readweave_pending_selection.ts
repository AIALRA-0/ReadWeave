/** Resolve the actual selection action, or fail visibly when attachment expires. */
export async function confirmReadWeavePendingSelection<T>(getAction: () => (() => Promise<T>) | undefined, attempts = 12): Promise<T> {
    for (let attempt = 0; attempt <= attempts; attempt++) {
        const action = getAction();
        if (action) return await action();
        if (attempt < attempts) await new Promise(resolve => window.setTimeout(resolve, 16));
    }
    throw new Error("选区确认失败，请重新选择正文后生成");
}
