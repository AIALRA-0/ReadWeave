import { expect, test } from "@playwright/test";

const BASE_URL = process.env["BASE_URL"] ?? "http://127.0.0.1:18082";

test("user note lifecycle does not leave idle ReadWeave polling behind", async ({ page }) => {
    const pageErrors: string[] = [];
    const generationListRequests: number[] = [];
    let csrfToken = "";
    let noteId = "";

    page.on("pageerror", error => pageErrors.push(String(error)));
    page.on("response", response => {
        if (/\/api\/readweave\/articles\/[^/]+\/generation-jobs(?:\?|$)/.test(response.url())) {
            generationListRequests.push(Date.now());
        }
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.locator("#left-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".note-title").first()).toBeVisible({ timeout: 30_000 });
    csrfToken = await page.evaluate(() => (window as unknown as { glob: { csrfToken: string } }).glob.csrfToken);

    const title = `ReadWeave 用户回归 ${Date.now()}`;
    const created = await page.request.post(`${BASE_URL}/api/notes/root/children?target=into&targetBranchId=`, {
        headers: { "x-csrf-token": csrfToken },
        data: { title, content: "<p>初始正文</p>", type: "text" }
    });
    expect(created.ok()).toBeTruthy();
    noteId = (await created.json()).note.noteId;

    try {
        const search = page.locator("input.search-string");
        await search.click();
        await search.pressSequentially(title);
        await search.press("Enter");
        const loading = page.locator(".quick-search .dropdown-item.disabled", { has: page.locator(".bx-loader") });
        await loading.waitFor({ state: "detached", timeout: 15_000 });
        const result = page.locator(`.quick-search .dropdown-item[href*="${noteId}"]`).first();
        await expect(result).toBeVisible();
        await result.click();

        const activeTitle = page.locator(".note-split:not(.hidden-ext) .note-title").first();
        const editor = page.locator(".note-split:not(.hidden-ext) .note-detail-editable-text-editor");
        await expect(activeTitle).toHaveValue(title, { timeout: 15_000 });
        await expect(editor).toContainText("初始正文", { timeout: 15_000 });

        const editedTitle = `${title} 已编辑`;
        const editedBody = `用户编辑后的正文 ${Date.now()}`;
        await activeTitle.fill(editedTitle);
        await activeTitle.press("Tab");
        await editor.fill(editedBody);

        await expect.poll(async () => {
            const response = await page.request.get(`${BASE_URL}/api/notes/${noteId}/blob`);
            return await response.text();
        }, { timeout: 15_000 }).toContain(editedBody);

        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        await expect(page.locator(".note-split:not(.hidden-ext) .note-title").first()).toHaveValue(editedTitle, { timeout: 30_000 });
        await expect(page.locator(".note-split:not(.hidden-ext) .note-detail-editable-text-editor")).toContainText(editedBody, { timeout: 30_000 });

        generationListRequests.length = 0;
        await page.waitForTimeout(6_500);
        expect(generationListRequests).toHaveLength(0);
        expect(pageErrors).toEqual([]);
    } finally {
        if (noteId && csrfToken) {
            await page.request.delete(`${BASE_URL}/api/notes/${noteId}?taskId=cleanup-${Date.now()}&last=true`, {
                headers: { "x-csrf-token": csrfToken }
            });
        }
    }
});
