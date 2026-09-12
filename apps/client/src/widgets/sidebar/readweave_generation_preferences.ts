export interface ReadWeaveGenerationPreferences {
    optimizeQuestion: boolean;
    autoApplyPlan: boolean;
    externalSearchDisabled: boolean;
    quoteSelectedText: boolean;
}

export const DEFAULT_READWEAVE_GENERATION_PREFERENCES: ReadWeaveGenerationPreferences = {
    optimizeQuestion: true, autoApplyPlan: true, externalSearchDisabled: false, quoteSelectedText: true
};

// localStorage already separates origins; pathname separates hosted instances.
export function readWeaveGenerationPreferenceKey(scope = window.location.pathname): string {
    return `readweave:generation-preferences:v1:${scope}`;
}

export function readReadWeaveGenerationPreferences(scope?: string): ReadWeaveGenerationPreferences {
    const result = { ...DEFAULT_READWEAVE_GENERATION_PREFERENCES };
    try {
        const stored = JSON.parse(localStorage.getItem(readWeaveGenerationPreferenceKey(scope)) ?? "null");
        for (const key of Object.keys(result) as (keyof ReadWeaveGenerationPreferences)[]) {
            if (typeof stored?.[key] === "boolean") result[key] = stored[key];
        }
    } catch { /* Storage may be disabled; defaults remain usable. */ }
    return result;
}

/** Called only on a user edit: restoring a draft must never replace defaults. */
export function writeReadWeaveGenerationPreference<K extends keyof ReadWeaveGenerationPreferences>(key: K, value: ReadWeaveGenerationPreferences[K], scope?: string) {
    const next = { ...readReadWeaveGenerationPreferences(scope), [key]: value };
    try { localStorage.setItem(readWeaveGenerationPreferenceKey(scope), JSON.stringify(next)); } catch { /* Keep the current draft usable. */ }
    return next;
}
