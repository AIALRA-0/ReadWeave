import type { OAuthStatus, ReadWeaveApiControlSettings } from "@triliumnext/commons";

import { t } from "../services/i18n";
import { oauthAccountLabel, oauthProviderDisplayName } from "../services/oauth_status";
import server from "../services/server";
import toast from "../services/toast";
import Component from "./component";

// TODO: Deduplicate.
interface CpuArchResponse {
    isCpuArchMismatch: boolean;
}

export class StartupChecks extends Component {

    constructor() {
        super();
        this.checkCpuArchMismatch();
        // Shared by desktop and mobile (both reach here via appContext.start), so the post-enrollment
        // toast lives here rather than being duplicated in each entry point.
        showOAuthEnrollmentResultToast();
        void syncReadWeaveApiAlertToast();
        setInterval(() => void syncReadWeaveApiAlertToast(), 5 * 60_000);
    }

    async checkCpuArchMismatch() {
        try {
            const response = await server.get("system-checks") as CpuArchResponse;
            if (response.isCpuArchMismatch) {
                this.triggerCommand("showCpuArchWarning", {});
            }
        } catch (error) {
            console.warn("Could not check CPU arch status:", error);
        }
    }
}

/**
 * Mirrors active server-side API alarms into one persistent, replaceable
 * notification. The server owns detection; this client poll only makes an
 * already-recorded outage visible without requiring the settings page to be
 * open.
 */
export async function syncReadWeaveApiAlertToast() {
    try {
        const settings = await server.get<ReadWeaveApiControlSettings>("readweave/api-control");
        const alerts = settings.alerts.filter(alert => alert.active);
        if (!alerts.length) {
            toast.closePersistent("readweave-api-alerts");
            return;
        }
        const providers = new Map(settings.providers.map(provider => [ provider.id, provider ]));
        const message = alerts.map(alert => {
            const provider = providers.get(alert.providerId);
            return t("readweave_api.alert_toast_line", {
                provider: provider?.name ?? alert.providerId,
                route: t(`readweave_api.role_${alert.routeRole}`),
                model: alert.model ?? t("readweave_api.not_applicable"),
                message: alert.message,
                lastSuccess: alert.lastSuccessAt ? new Date(alert.lastSuccessAt).toLocaleString() : "—",
                fallback: alert.fallbackAvailable ? t("readweave_api.fallback_available") : t("readweave_api.fallback_unavailable"),
                action: alert.requiresAction ? t("readweave_api.action_required") : "—"
            });
        }).join("\n");
        toast.showPersistent({
            id: "readweave-api-alerts",
            icon: "bx bx-error-circle",
            title: t("readweave_api.alert_toast_title", { count: alerts.length }),
            message,
            messageMonospace: false,
            wide: true
        });
    } catch {
        // Startup and reconnect code already reports application-wide network
        // failures. Avoid duplicating those as a misleading provider alarm.
    }
}

/**
 * Shows a one-shot "account connected" toast after the OAuth provider round-trip redirects back to the
 * app root (which drops the Settings modal). The signal rides in the server's bootstrap payload
 * (`window.glob.oauthJustEnrolled`, set once by the OIDC afterCallback and cleared by /bootstrap), so
 * nothing has to be stored on the client across the redirect.
 */
export async function showOAuthEnrollmentResultToast() {
    if (!window.glob?.oauthJustEnrolled) {
        return;
    }

    try {
        const status = await server.get<OAuthStatus>("oauth/status");
        toast.showMessage(t("multi_factor_authentication.oauth_connect_success", {
            account: oauthAccountLabel(status),
            provider: oauthProviderDisplayName(status)
        }));
    } catch {
        // Couldn't resolve the account details — still confirm the connection generically.
        toast.showMessage(t("multi_factor_authentication.oauth_connect_success_generic"));
    }
}
