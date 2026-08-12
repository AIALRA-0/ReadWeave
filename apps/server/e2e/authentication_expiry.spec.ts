import { expect, test } from "@playwright/test";

test.skip(process.env.READWEAVE_AUTH_E2E !== "1", "Run with playwright.auth.config.ts");

const protectedStartupPaths = new Set([
    "/api/fonts",
    "/api/options",
    "/api/keyboard-actions",
    "/api/tree"
]);

async function waitForLogin(page: import("@playwright/test").Page) {
    await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 10_000 });
}

async function waitForWorkspace(page: import("@playwright/test").Page) {
    await expect(page.locator(".tree-wrapper")).toContainText("Trilium Integration Test", { timeout: 30_000 });
    await expect(page.locator(".note-split:not(.hidden-ext)")).toBeVisible({ timeout: 15_000 });
    await expect.poll(
        () => page.evaluate(() => Boolean((window as typeof window & { glob?: { appContext?: unknown } }).glob?.appContext)),
        { timeout: 15_000 }
    ).toBe(true);
}

async function login(page: import("@playwright/test").Page) {
    await page.locator('input[name="password"]').fill("demo1234");
    await page.locator('input[name="password"]').press("Enter");
    await waitForWorkspace(page);
}

test("expired login state returns to login, stops startup transports, and recovers after sign-in", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("baseURL is required");

    const startupRequests: string[] = [];
    let webSocketAttempts = 0;
    page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (protectedStartupPaths.has(path)) startupRequests.push(path);
    });
    page.on("websocket", () => {
        webSocketAttempts += 1;
    });

    // An arbitrary server-unknown cookie must go directly to login and must
    // not start protected resources or a reconnecting WebSocket.
    await context.addCookies([{
        name: "trilium.sid",
        value: "s%3Aexpired-readweave-session.invalid-signature",
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax"
    }]);
    let startedAt = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 });
    await waitForLogin(page);
    const invalidCookieLoginMs = Date.now() - startedAt;
    const bootstrapHeaders = await page.evaluate(async () => {
        const response = await fetch("./bootstrap", { cache: "no-store" });
        return {
            cacheControl: response.headers.get("cache-control"),
            vary: response.headers.get("vary")
        };
    });
    expect(bootstrapHeaders.cacheControl).toContain("no-store");
    expect(bootstrapHeaders.vary).toContain("Cookie");
    await page.waitForTimeout(1_500);
    expect(startupRequests).toEqual([]);
    expect(webSocketAttempts).toBe(0);

    await login(page);

    // Keep a copy of this browser's authenticated cookie, then log out normally
    // so only this disposable session is destroyed. Restoring that old value
    // reproduces a browser cookie whose server-side session no longer exists.
    const authenticatedCookie = (await context.cookies()).find(cookie => cookie.name === "trilium.sid");
    expect(authenticatedCookie).toBeDefined();
    const logoutStatus = await page.evaluate(async () => {
        const response = await fetch("./logout", {
            method: "POST",
            headers: { "x-csrf-token": (window as typeof window & { glob: { csrfToken: string } }).glob.csrfToken }
        });
        return response.status;
    });
    expect(logoutStatus).toBe(200);
    await context.addCookies([authenticatedCookie!]);

    startupRequests.length = 0;
    webSocketAttempts = 0;
    startedAt = Date.now();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await waitForLogin(page);
    const expiredSessionLoginMs = Date.now() - startedAt;
    await page.waitForTimeout(1_500);
    expect(startupRequests).toEqual([]);
    expect(webSocketAttempts).toBe(0);
    await expect(page.locator("#authentication-recovery")).toHaveCount(0);

    startedAt = Date.now();
    await login(page);
    const reloginWorkspaceMs = Date.now() - startedAt;

    startupRequests.length = 0;
    webSocketAttempts = 0;
    startedAt = Date.now();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await waitForWorkspace(page);
    const validSessionReloadMs = Date.now() - startedAt;
    expect(webSocketAttempts).toBeLessThanOrEqual(1);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    const validReloadProtectedRequests = [...startupRequests];
    const validReloadWebSocketAttempts = webSocketAttempts;

    // Reproduce the original failure precisely: the browser reuses a stale
    // authenticated bootstrap once, while every protected API already sees the
    // session as logged out. Recovery must converge after one request wave.
    const staleBootstrap = await page.evaluate(async () => await (await fetch("./bootstrap", { cache: "no-store" })).json());
    const staleCookie = (await context.cookies()).find(cookie => cookie.name === "trilium.sid");
    expect(staleCookie).toBeDefined();
    const finalLogoutStatus = await page.evaluate(async () => {
        const response = await fetch("./logout", {
            method: "POST",
            headers: { "x-csrf-token": (window as typeof window & { glob: { csrfToken: string } }).glob.csrfToken }
        });
        return response.status;
    });
    expect(finalLogoutStatus).toBe(200);
    await context.addCookies([staleCookie!]);
    await page.route("**/bootstrap*", async route => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
            body: JSON.stringify(staleBootstrap)
        });
    }, { times: 1 });
    startupRequests.length = 0;
    webSocketAttempts = 0;
    startedAt = Date.now();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await waitForLogin(page);
    const staleBootstrapRecoveryMs = Date.now() - startedAt;
    await page.waitForTimeout(2_000);
    const protectedRequestCounts = Object.fromEntries(
        [...protectedStartupPaths].map(path => [path, startupRequests.filter(item => item === path).length])
    );
    expect(Math.max(...Object.values(protectedRequestCounts))).toBeLessThanOrEqual(1);
    expect(webSocketAttempts).toBeLessThanOrEqual(1);

    console.log("READWEAVE_AUTH_E2E_METRICS", JSON.stringify({
        invalidCookieLoginMs,
        expiredSessionLoginMs,
        reloginWorkspaceMs,
        validSessionReloadMs,
        staleBootstrapRecoveryMs,
        staleBootstrapProtectedRequestCounts: protectedRequestCounts,
        staleBootstrapWebSocketAttempts: webSocketAttempts,
        validReloadProtectedRequests,
        validReloadWebSocketAttempts
    }));
});
