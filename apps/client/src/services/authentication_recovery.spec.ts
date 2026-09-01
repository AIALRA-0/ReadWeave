import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    AUTHENTICATION_REQUIRED_EVENT,
    loadFreshBootstrap,
    recoverExpiredAuthentication,
    resetAuthenticationRecoveryForTest
} from "./authentication_recovery";

describe("authentication recovery", () => {
    beforeEach(() => {
        resetAuthenticationRecoveryForTest();
        document.body.replaceChildren();
        document.body.style.display = "none";
        document.body.lang = "zh-CN";
        (window as unknown as { glob?: { loggedIn: boolean } }).glob = { loggedIn: true };
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("loads bootstrap state without browser caching", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ loggedIn: true, marker: "fresh" })
        }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(loadFreshBootstrap<{ marker: string }>({ query: "?desktop" }))
            .resolves.toEqual({ loggedIn: true, marker: "fresh" });
        expect(fetchMock).toHaveBeenCalledWith("./bootstrap?desktop", {
            cache: "no-store",
            credentials: "same-origin"
        });
        expect(document.querySelector("#authentication-recovery")).toBeNull();
    });

    it("turns a bootstrap 401 into one visible login recovery", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: false,
            status: 401,
            json: async () => ({})
        })));
        const navigate = vi.fn();
        const event = vi.fn();
        window.addEventListener(AUTHENTICATION_REQUIRED_EVENT, event, { once: true });

        await expect(loadFreshBootstrap({ query: "", navigate })).rejects.toThrow("Authentication is required");

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(event).toHaveBeenCalledTimes(1);
        expect(window.glob.loggedIn).toBe(false);
        expect(document.body.style.display).toBe("block");
        expect(document.body.textContent).toContain("登录状态已失效");
        expect(document.querySelector<HTMLAnchorElement>("#authentication-recovery a")?.href)
            .toBe(navigate.mock.calls[0][0]);

        expect(recoverExpiredAuthentication({ navigate })).toBe(false);
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it("reports non-authentication bootstrap failures without entering login recovery", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: false,
            status: 503,
            json: async () => ({})
        })));
        const navigate = vi.fn();

        await expect(loadFreshBootstrap({ navigate })).rejects.toThrow("Bootstrap failed with HTTP 503");
        expect(navigate).not.toHaveBeenCalled();
        expect(window.glob.loggedIn).toBe(true);
    });

    it("breaks a repeated recovery navigation cycle across page loads", () => {
        const firstNavigate = vi.fn();
        expect(recoverExpiredAuthentication({ navigate: firstNavigate })).toBe(true);
        expect(firstNavigate).toHaveBeenCalledTimes(1);

        resetAuthenticationRecoveryForTest();
        (window as unknown as { glob?: { loggedIn: boolean } }).glob = { loggedIn: true };
        const repeatedNavigate = vi.fn();

        expect(recoverExpiredAuthentication({ navigate: repeatedNavigate })).toBe(false);
        expect(repeatedNavigate).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("登录状态已失效");
    });

    it("allows a new recovery after an authenticated bootstrap clears the navigation guard", async () => {
        const firstNavigate = vi.fn();
        expect(recoverExpiredAuthentication({ navigate: firstNavigate })).toBe(true);

        resetAuthenticationRecoveryForTest();
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ loggedIn: true })
        })));
        await expect(loadFreshBootstrap()).resolves.toEqual({ loggedIn: true });

        const secondNavigate = vi.fn();
        expect(recoverExpiredAuthentication({ navigate: secondNavigate })).toBe(true);
        expect(secondNavigate).toHaveBeenCalledTimes(1);
    });
});
