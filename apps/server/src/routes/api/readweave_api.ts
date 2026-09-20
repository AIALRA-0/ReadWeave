import type { ReadWeaveApiControlUpdate, ReadWeaveApiProviderId, ReadWeaveApiProbeRequest } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import { probeReadWeaveApiProvider, runReadWeaveApiHealthChecks } from "../../services/readweave_api_health.js";
import { getReadWeaveApiControlSettings, updateReadWeaveApiControlSettings } from "../../services/readweave_api_registry.js";

function getSnapshot() {
    return getReadWeaveApiControlSettings();
}

function update(req: Request) {
    return updateReadWeaveApiControlSettings((req.body ?? {}) as ReadWeaveApiControlUpdate);
}

async function probe(req: Request<{ providerId: string }>) {
    const providerId = req.params.providerId as ReadWeaveApiProviderId;
    const full = (req.body as ReadWeaveApiProbeRequest | undefined)?.full !== false;
    if (!getReadWeaveApiControlSettings().providers.some(provider => provider.id === providerId)) {
        throw new ValidationError(`未知的 API 平台：${providerId}`);
    }
    return { provider: await probeReadWeaveApiProvider(providerId, full) };
}

async function probeAll(req: Request) {
    const full = (req.body as ReadWeaveApiProbeRequest | undefined)?.full !== false;
    return await runReadWeaveApiHealthChecks(full);
}

export default { getSnapshot, update, probe, probeAll };
