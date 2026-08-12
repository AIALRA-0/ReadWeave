/**
 * Browser event emitted before an expired authenticated client is returned to
 * the login screen. Long-lived transports use it to stop reconnecting while
 * the old page is being replaced.
 */
export const AUTHENTICATION_REQUIRED_EVENT = "trilium:authentication-required";

let recoveryStarted = false;

interface RecoveryOptions {
    navigate?: (url: string) => void;
}

interface FreshBootstrapOptions extends RecoveryOptions {
    query?: string;
}

/**
 * Fetches authentication-sensitive startup state without consulting browser or
 * intermediary caches. A 401 enters the same recovery path as protected APIs.
 */
export async function loadFreshBootstrap<T>(options: FreshBootstrapOptions = {}): Promise<T> {
    const response = await fetch(`./bootstrap${options.query ?? window.location.search}`, {
        cache: "no-store",
        credentials: "same-origin"
    });
    if (response.status === 401) {
        recoverExpiredAuthentication({ navigate: options.navigate });
        throw new Error("Authentication is required");
    }
    if (!response.ok) {
        throw new Error(`Bootstrap failed with HTTP ${response.status}`);
    }
    return await response.json() as T;
}

/**
 * Returns the application root without retaining a note hash or stale query
 * string. `document.baseURI` also keeps installations hosted below `/` working.
 */
function getApplicationRoot(): string {
    return new URL("./", document.baseURI).toString();
}

/**
 * Makes the recovery state visible immediately. Navigation normally replaces
 * it almost at once, but users still get a clear sign-in action when a proxy or
 * browser delays that navigation.
 */
function renderRecoveryScreen(targetUrl: string): void {
    const chinese = document.body.lang.toLowerCase().startsWith("zh")
        || document.documentElement.lang.toLowerCase().startsWith("zh");
    const title = chinese ? "登录状态已失效" : "Session expired";
    const message = chinese
        ? "ReadWeave 正在返回登录页。重新登录后，笔记树和编辑器会自动恢复。"
        : "ReadWeave is returning to the sign-in page. Your note tree and editor will load again after you sign in.";
    const action = chinese ? "重新登录" : "Sign in again";

    const wrapper = document.createElement("main");
    wrapper.id = "authentication-recovery";
    wrapper.setAttribute("role", "alert");
    wrapper.style.cssText = "min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f6f8;color:#202124;font-family:system-ui,sans-serif";

    const card = document.createElement("section");
    card.style.cssText = "width:min(460px,100%);padding:28px;border:1px solid #d9dce1;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)";

    const heading = document.createElement("h1");
    heading.style.cssText = "margin:0 0 12px;font-size:24px;line-height:1.3";
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.style.cssText = "margin:0 0 20px;line-height:1.65;color:#5f6368";
    paragraph.textContent = message;

    const link = document.createElement("a");
    link.href = targetUrl;
    link.style.cssText = "display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600";
    link.textContent = action;

    card.append(heading, paragraph, link);
    wrapper.append(card);
    document.body.replaceChildren(wrapper);
    document.body.style.display = "block";
}

/**
 * Collapses concurrent 401 responses into one recovery. The visible fallback is
 * rendered before transports are stopped and the browser navigates, preventing
 * the former blank-screen state even if several startup requests fail together.
 */
export function recoverExpiredAuthentication(options: RecoveryOptions = {}): boolean {
    if (recoveryStarted) {
        return false;
    }

    recoveryStarted = true;
    if (window.glob) {
        window.glob.loggedIn = false;
    }

    const targetUrl = getApplicationRoot();
    renderRecoveryScreen(targetUrl);
    window.dispatchEvent(new CustomEvent(AUTHENTICATION_REQUIRED_EVENT));

    const navigate = options.navigate ?? ((url: string) => window.location.replace(url));
    navigate(targetUrl);
    return true;
}

/** Test-only reset for isolated module tests. */
export function resetAuthenticationRecoveryForTest(): void {
    recoveryStarted = false;
}

