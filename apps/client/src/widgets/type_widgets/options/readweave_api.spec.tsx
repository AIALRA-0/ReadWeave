import type { ReadWeaveApiControlSettings, ReadWeaveApiProviderProfile } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverGet, serverPut, serverPost } = vi.hoisted(() => ({
    serverGet: vi.fn(),
    serverPut: vi.fn(),
    serverPost: vi.fn()
}));

vi.mock("../../../services/server", () => ({
    default: {
        get: serverGet,
        put: serverPut,
        post: serverPost
    }
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string, values?: Record<string, unknown>) => values
        ? `${key} ${Object.values(values).join(" ")}`
        : key
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ actions }: { actions?: unknown }) => <header>{actions as never}</header>
}));

vi.mock("./components/OptionsSection", () => ({
    default: ({ title, description, children }: { title?: unknown; description?: unknown; children?: unknown }) => (
        <section>
            <h2>{title as never}</h2>
            <p>{description as never}</p>
            {children as never}
        </section>
    )
}));

vi.mock("../../react/Button", () => ({
    default: ({ text, onClick, disabled }: { text: unknown; onClick?: () => void; disabled?: boolean }) => (
        <button type="button" disabled={disabled} onClick={onClick}>{text as never}</button>
    )
}));

import ReadWeaveApiSettings from "./readweave_api";

function provider(overrides: Partial<ReadWeaveApiProviderProfile> = {}): ReadWeaveApiProviderProfile {
    return {
        id: "kuafu",
        name: "Kuafu",
        kind: "model",
        enabled: true,
        role: "primary",
        priority: 10,
        baseUrl: "https://example.test/v1",
        endpoint: "/responses",
        authType: "bearer",
        requestProtocol: "responses",
        model: "deepseek-v4.1-flash",
        configuredModels: [ "deepseek-v4.1-flash" ],
        hasApiKey: true,
        maskedApiKey: "sk-••••test",
        credentialSource: "api-control",
        health: {
            state: "healthy",
            latencyMs: 420,
            successRate: 0.975,
            consecutiveFailures: 0,
            lastSuccessAt: "2026-09-19T12:00:00.000Z",
            quota: { supported: true, unit: "USD", remaining: 4.2, limit: 5 }
        },
        ...overrides
    };
}

function snapshot(overrides: Partial<ReadWeaveApiControlSettings> = {}): ReadWeaveApiControlSettings {
    return {
        version: 1,
        healthCheckIntervalMinutes: 15,
        fullProbeIntervalMinutes: 360,
        providers: [ provider() ],
        alerts: [],
        monitor: { running: true },
        ...overrides
    };
}

let container: HTMLDivElement;

async function renderSettings(value = snapshot()) {
    serverGet.mockResolvedValue(value);
    serverPut.mockResolvedValue(value);
    serverPost.mockResolvedValue(value);
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<ReadWeaveApiSettings />, container);
    await vi.waitFor(() => expect(serverGet).toHaveBeenCalledWith("readweave/api-control"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='readweave-api-provider-kuafu']")).not.toBeNull());
    return container;
}

function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find(item => item.textContent?.includes(label));
    if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
    return match;
}

function inputByLabel(label: string): HTMLInputElement {
    const match = Array.from(container.querySelectorAll("label")).find(item => item.textContent?.includes(label))?.querySelector("input");
    if (!(match instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);
    return match;
}

afterEach(() => {
    render(null, container);
    container?.remove();
    vi.clearAllMocks();
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("ReadWeave API settings", () => {
    it("renders independent provider configuration, health, quota, and alerts", async () => {
        await renderSettings(snapshot({
            alerts: [ {
                id: "kuafu:quota-low",
                providerId: "kuafu",
                routeRole: "primary",
                model: "deepseek-v4.1-flash",
                code: "quota-low",
                severity: "warning",
                message: "Quota is low",
                active: true,
                firstSeenAt: "2026-09-19T12:00:00.000Z",
                lastSeenAt: "2026-09-19T12:05:00.000Z",
                fallbackAvailable: true,
                requiresAction: false
            } ]
        }));

        expect(container.textContent).toContain("Kuafu");
        expect(container.textContent).toContain("/responses");
        expect(container.textContent).toContain("readweave_api.auth_bearer");
        expect(container.textContent).toContain("420 ms");
        expect(container.textContent).toContain("97.5%");
        expect(container.textContent).toContain("4.2 USD");
        expect(container.textContent).toContain("Quota is low");
        expect(inputByLabel("readweave_api.api_key").placeholder).toBe("sk-••••test");
    });

    it("keeps the stored credential when the key field is blank and sends a newly entered key", async () => {
        await renderSettings();

        button("readweave_api.save").click();
        await vi.waitFor(() => expect(serverPut).toHaveBeenCalledTimes(1));
        const firstUpdate = serverPut.mock.calls[0][1];
        expect(firstUpdate.providers[0]).not.toHaveProperty("apiKey");
        await vi.waitFor(() => expect(button("readweave_api.save").disabled).toBe(false));

        const keyInput = inputByLabel("readweave_api.api_key");
        await act(async () => {
            keyInput.value = "sk-new-value";
            keyInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        button("readweave_api.save").click();

        await vi.waitFor(() => expect(serverPut).toHaveBeenCalledTimes(2));
        expect(serverPut.mock.calls[1][1].providers[0].apiKey).toBe("sk-new-value");
    });

    it("runs a provider probe and refreshes the complete snapshot", async () => {
        await renderSettings();
        serverGet.mockClear();

        button("readweave_api.probe_provider").click();

        await vi.waitFor(() => expect(serverPost).toHaveBeenCalledWith(
            "readweave/api-control/providers/kuafu/probe",
            { full: true }
        ));
        await vi.waitFor(() => expect(serverGet).toHaveBeenCalledWith("readweave/api-control"));
    });

    it("runs a full probe and applies the returned snapshot", async () => {
        await renderSettings();
        const updated = snapshot({ monitor: { running: true, lastCycleAt: "2026-09-19T13:00:00.000Z" } });
        serverPost.mockResolvedValue(updated);

        button("readweave_api.probe_all").click();

        await vi.waitFor(() => expect(serverPost).toHaveBeenCalledWith("readweave/api-control/probe-all", { full: true }));
        await vi.waitFor(() => expect(container.textContent).toContain("2026"));
    });
});
