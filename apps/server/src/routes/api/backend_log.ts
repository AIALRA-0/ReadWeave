"use strict";

import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import dateUtils from "../../services/date_utils.js";
import dataDir from "../../services/data_dir.js";
import log from "../../services/log.js";
import { t } from "i18next";

const { LOG_DIR } = dataDir;

async function getBackendLog() {
    const requestedDate = dateUtils.localNowDate();
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : new Date().toISOString().slice(0, 10);
    const fileName = `trilium-${safeDate}.log`;
    try {
        const logRoot = `${resolve(LOG_DIR)}${sep}`;
        const file = resolve(LOG_DIR, fileName);
        if (!file.startsWith(logRoot)) {
            throw new Error("Resolved log path is outside the log directory");
        }
        return await readFile(file, "utf8");
    } catch (e) {
        const isErrorInstance = e instanceof Error;

        // most probably the log file does not exist yet - https://github.com/zadam/trilium/issues/1977
        if (isErrorInstance && "code" in e && e.code === "ENOENT") {
            log.error(e);
            return t("backend_log.log-does-not-exist", { fileName });
        }

        log.error(isErrorInstance ? e : `Reading the backend log '${fileName}' failed with an unknown error: '${e}'.`);
        return t("backend_log.reading-log-failed", { fileName });
    }
}

export default {
    getBackendLog
};
