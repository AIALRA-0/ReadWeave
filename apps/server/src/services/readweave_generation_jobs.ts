import type {
    ReadWeaveGenerateRequest,
    ReadWeaveGenerationJob,
    ReadWeaveGenerationProgress
} from "@triliumnext/commons";
import { randomUUID } from "crypto";

import ValidationError from "../errors/validation_error.js";
import { generateReadWeaveAnswer } from "./readweave_ai.js";

interface StoredJob extends ReadWeaveGenerationJob {
    request: ReadWeaveGenerateRequest;
}

const jobs = new Map<string, StoredJob>();
const JOB_TTL_MS = 30 * 60 * 1_000;

function publicJob(job: StoredJob): ReadWeaveGenerationJob {
    const { request: _request, ...value } = job;
    return structuredClone(value);
}

function cleanupJobs() {
    const oldest = Date.now() - JOB_TTL_MS;
    for (const [jobId, job] of jobs) {
        if (Date.parse(job.updatedAt) < oldest) jobs.delete(jobId);
    }
}

export function startReadWeaveGenerationJob(request: ReadWeaveGenerateRequest): ReadWeaveGenerationJob {
    cleanupJobs();
    const now = new Date().toISOString();
    const job: StoredJob = {
        jobId: randomUUID(),
        status: "running",
        progress: [],
        request: structuredClone(request),
        createdAt: now,
        updatedAt: now
    };
    jobs.set(job.jobId, job);

    void generateReadWeaveAnswer(job.request, (progress: ReadWeaveGenerationProgress) => {
        job.progress.push(structuredClone(progress));
        job.progress = job.progress.slice(-80);
        job.updatedAt = new Date().toISOString();
    }).then(result => {
        job.result = result;
        job.status = "complete";
        job.updatedAt = new Date().toISOString();
    }).catch(error => {
        job.error = error instanceof Error ? error.message : "ReadWeave generation failed for an unknown reason.";
        job.status = "failed";
        job.updatedAt = new Date().toISOString();
    });

    return publicJob(job);
}

export function getReadWeaveGenerationJob(jobId: string): ReadWeaveGenerationJob {
    cleanupJobs();
    const job = jobs.get(jobId);
    if (!job) throw new ValidationError("ReadWeave generation job was not found or has expired.");
    return publicJob(job);
}
