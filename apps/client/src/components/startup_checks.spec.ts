import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../services/server";
import toast from "../services/toast";

import { showOAuthEnrollmentResultToast, syncReadWeaveApiAlertToast } from "./startup_checks";

vi.mock("../services/server", () => ({ default: { get: vi.fn() } }));
vi.mock("../services/toast", () => ({ default: {
    showMessage: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn()
} }));
// Echo interpolation values so assertions can verify the resolved account/provider.
vi.mock("../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)
}));

const serverGet = vi.mocked(server.get);
const showMessage = vi.mocked(toast.showMessage);

function setGlob(glob: Record<string, unknown> | undefined) {
    (window as unknown as { glob?: unknown }).glob = glob;
}

describe("showOAuthEnrollmentResultToast", () => {
    afterEach(() => {
        vi.clearAllMocks();
        setGlob(undefined);
    });

    it("toasts the connected account/provider when the bootstrap reports a fresh enrollment", async () => {
        setGlob({ oauthJustEnrolled: true });
        serverGet.mockResolvedValue({ email: "alice@example.com", issuerName: "Acme" });

        await showOAuthEnrollmentResultToast();

        expect(serverGet).toHaveBeenCalledWith("oauth/status");
        const message = showMessage.mock.calls[0]?.[0];
        expect(message).toContain("oauth_connect_success");
        expect(message).toContain("alice@example.com");
        expect(message).toContain("Acme");
    });

    it("falls back to a generic message when the status probe fails", async () => {
        setGlob({ oauthJustEnrolled: true });
        serverGet.mockRejectedValue(new Error("network down"));

        await showOAuthEnrollmentResultToast();

        expect(showMessage).toHaveBeenCalledWith("multi_factor_authentication.oauth_connect_success_generic");
    });

    it("does nothing without the bootstrap flag", async () => {
        setGlob({});
        await showOAuthEnrollmentResultToast();

        setGlob(undefined);
        await showOAuthEnrollmentResultToast();

        expect(serverGet).not.toHaveBeenCalled();
        expect(showMessage).not.toHaveBeenCalled();
    });
});

describe("syncReadWeaveApiAlertToast", () => {
    afterEach(() => vi.clearAllMocks());

    it("shows every active provider alarm with route and fallback state", async () => {
        serverGet.mockResolvedValue({
            providers: [ { id: "kuafu", name: "夸父社 V4.1 专线" } ],
            alerts: [ {
                id: "kuafu:authentication", providerId: "kuafu", routeRole: "primary",
                model: "deepseek-v4.1-flash", code: "authentication", message: "API Key 无效",
                active: true, firstSeenAt: "2026-09-19T00:00:00Z", lastSeenAt: "2026-09-19T00:00:00Z",
                fallbackAvailable: false, requiresAction: true
            } ]
        });

        await syncReadWeaveApiAlertToast();

        expect(toast.showPersistent).toHaveBeenCalledWith(expect.objectContaining({
            id: "readweave-api-alerts",
            message: expect.stringContaining("夸父社 V4.1 专线")
        }));
    });

    it("closes the persistent alarm after every active issue is resolved", async () => {
        serverGet.mockResolvedValue({ providers: [], alerts: [] });
        await syncReadWeaveApiAlertToast();
        expect(toast.closePersistent).toHaveBeenCalledWith("readweave-api-alerts");
    });
});
