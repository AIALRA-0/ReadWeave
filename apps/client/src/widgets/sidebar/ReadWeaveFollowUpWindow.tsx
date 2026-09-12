import {
    READWEAVE_MAX_FOLLOW_UP_DEPTH,
    type ReadWeaveAnswerPlan,
    type ReadWeaveAnswerSelection,
    type ReadWeaveGenerationJob,
    type ReadWeaveResolvedEntry,
} from "@triliumnext/commons";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import server from "../../services/server.js";
import { readReadWeaveGenerationPreferences, type ReadWeaveGenerationPreferences } from "./readweave_generation_preferences.js";
import { DEFAULT_READWEAVE_QUESTION_TEMPLATES, renderReadWeaveQuestionTemplate } from "./readweave_question_templates.js";
import { ReadWeaveAnswer } from "./ReadWeaveAnswer.js";
import { createEditableReadWeaveAnswerPlan, normalizeEditableReadWeaveAnswerPlan, splitPlanLines } from "./readweave_answer_plan.js";

export function ReadWeaveFollowUpWindow({
    parent,
    selection,
    onClose,
    onOpen,
    onJob,
    externalSearchDisabled,
    generationPreferences,
}: {
    parent: ReadWeaveResolvedEntry;
    selection: ReadWeaveAnswerSelection;
    onClose: () => void;
    onOpen: (parent: ReadWeaveResolvedEntry, selection: ReadWeaveAnswerSelection) => void;
    onJob: (job: ReadWeaveGenerationJob) => void;
    externalSearchDisabled?: boolean;
    generationPreferences?: ReadWeaveGenerationPreferences;
}) {
    const key = `readweave:follow-up:${parent.linkId}:${parent.revision}:${selection.startOffset}:${selection.endOffset}`;
    const [preferences] = useState(() => generationPreferences ?? readReadWeaveGenerationPreferences());
    const [title, setTitle] = useState(() => renderReadWeaveQuestionTemplate(DEFAULT_READWEAVE_QUESTION_TEMPLATES[0], selection.text, preferences.quoteSelectedText));
    const [job, setJob] = useState<ReadWeaveGenerationJob>();
    const [answerPlan, setAnswerPlan] = useState<ReadWeaveAnswerPlan>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [searchDisabled] = useState(externalSearchDisabled ?? preferences.externalSearchDisabled);
    const [position, setPosition] = useState({
        x: Math.max(8, Math.min(window.innerWidth - 490, 80 + parent.depth * 32)),
        y: 90 + parent.depth * 28,
    });
    const lock = useRef(false);
    const mounted = useRef(true);
    const active =
        job?.status === "queued" || job?.status === "running" || job?.status === "saving";
    const onJobRef = useRef(onJob);
    onJobRef.current = onJob;
    const accept = useCallback((next: ReadWeaveGenerationJob) => {
        onJobRef.current(next);
        sessionStorage.setItem(key, next.jobId);
        if (mounted.current) setJob(next);
    }, [key]);
    useEffect(() => {
        mounted.current = true;
        const savedId = sessionStorage.getItem(key);
        if (savedId)
            void server
                .get<{ job: ReadWeaveGenerationJob }>(
                    `readweave/generation-jobs/${encodeURIComponent(savedId)}`,
                )
                .then((response) => {
                    if (mounted.current) {
                        accept(response.job);
                        setTitle(response.job.title);
                        setAnswerPlan(response.job.answerPlan);
                    }
                })
                .catch(() => sessionStorage.removeItem(key));
        return () => {
            mounted.current = false;
        };
    }, [key, accept]);
    useEffect(() => {
        if (!job || !active) return;
        const jobId = job.jobId;
        let stopped = false;
        let timer = 0;
        let failures = 0;
        async function poll() {
            try {
                const response = await server.get<{ job: ReadWeaveGenerationJob }>(
                    `readweave/generation-jobs/${encodeURIComponent(jobId)}`,
                );
                if (!stopped) {
                    setError("");
                    accept(response.job);
                }
            } catch {
                if (!stopped) {
                    failures++;
                    setError("连接暂时中断，正在恢复已有生成结果，不会重复生成");
                    timer = window.setTimeout(() => void poll(), Math.min(1000 * 2 ** failures, 15000));
                }
            }
        }
        timer = window.setTimeout(() => void poll(), 1000);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [job, active, accept]);
    async function action(operation: () => Promise<void>) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await operation();
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            lock.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    async function generate() {
        if (!title.trim() || parent.depth >= READWEAVE_MAX_FOLLOW_UP_DEPTH || active) return;
        if (!preferences.autoApplyPlan && !answerPlan) {
            setAnswerPlan(createEditableReadWeaveAnswerPlan(title, "problem", preferences.quoteSelectedText));
            return;
        }
        const preparedPlan = answerPlan
            ? normalizeEditableReadWeaveAnswerPlan(answerPlan, true, preferences.autoApplyPlan) : undefined;
        if (!preferences.autoApplyPlan && !preparedPlan) {
            setError("流程需要填写目标、必答项和至少一个有效步骤");
            return;
        }
        await action(async () => {
            const response =
                job && !job.savedLinkId && title === job.title
                    ? await server.post<{ job: ReadWeaveGenerationJob }>(
                        `readweave/generation-jobs/${encodeURIComponent(job.jobId)}/regenerate`,
                        { title, answerPlan:preparedPlan, autoApplyPlan:preferences.autoApplyPlan,
                            quoteSelectedText: job.quoteSelectedText ?? preferences.quoteSelectedText },
                    )
                    : await server.post<{ job: ReadWeaveGenerationJob }>(
                        "readweave/generation-jobs",
                        {
                            articleId: parent.articleId,
                            anchorId: parent.anchorId,
                            anchorType: parent.anchorType,
                            kind: "question",
                            contentType: "problem",
                            origin: "generated",
                            parentLinkId: parent.linkId,
                            answerSelection: selection,
                            title,
                            optimizeQuestion: preferences.optimizeQuestion,
                            autoApplyPlan: preferences.autoApplyPlan,
                            answerPlan: preparedPlan,
                            quoteSelectedText: preferences.quoteSelectedText,
                            autoExternalSearch: !searchDisabled,
                            activeExternalSearch: false,
                            fragments: [
                                {
                                    id: "answer-selection",
                                    role: "selected",
                                    text: selection.text,
                                },
                                { id:"parent-answer", role:"previous", text:parent.body },
                            ],
                        },
                    );
            accept(response.job);
        });
    }
    async function saveAndFollowUp(nextSelection?: ReadWeaveAnswerSelection) {
        await action(async () => {
            if (!job?.result?.body) return;
            let saved = job;
            if (!saved.savedLinkId) {
                saved = (
                    await server.post<{ job: ReadWeaveGenerationJob }>(
                        `readweave/generation-jobs/${encodeURIComponent(job.jobId)}/commit`,
                        {
                            expectedStateVersion: job.stateVersion,
                            title: job.title,
                            body: job.result.body,
                        },
                    )
                ).job;
                accept(saved);
            }
            if (nextSelection && saved.savedLinkId) {
                const response = await server.get<{ entries: ReadWeaveResolvedEntry[] }>(
                    `readweave/articles/${encodeURIComponent(parent.articleId)}/anchors/${encodeURIComponent(parent.anchorId)}`,
                );
                const entry = response.entries.find((entry) => entry.linkId === saved.savedLinkId);
                if (!entry) throw new Error("未找到已保存的父回答，未创建追问");
                onOpen(entry, { ...nextSelection, parentRevision: entry.revision });
            }
        });
    }
    const level = parent.depth + 1;
    return createPortal(
        <section
            class="readweave-follow-up-window"
            role="dialog"
            aria-modal="false"
            aria-label={`第 ${level} 层追问`}
            style={{ left: `${position.x}px`, top: `${position.y}px`, maxHeight:`calc(100vh - ${position.y + 8}px)` }}
            data-testid="readweave-follow-up-window"
        >
            <header
                onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    const origin = { x: event.clientX - position.x, y: event.clientY - position.y };
                    const target = event.currentTarget;
                    target.setPointerCapture(event.pointerId);
                    target.onpointermove = (next) =>
                        setPosition({
                            x: Math.max(
                                0,
                                Math.min(window.innerWidth - 80, next.clientX - origin.x),
                            ),
                            y: Math.max(
                                0,
                                Math.min(window.innerHeight - 70, next.clientY - origin.y),
                            ),
                        });
                    target.onpointerup = () => {
                        target.onpointermove = null;
                        target.onpointerup = null;
                    };
                }}
            >
                <strong>追问 · 第 {level}/3 层</strong>
                <button
                    type="button"
                    class="btn btn-sm"
                    onClick={onClose}
                    aria-label="关闭追问浮窗"
                >
                    ×
                </button>
            </header>
            <div class="readweave-follow-up-content">
                <blockquote>
                    <ReadWeaveAnswer body={selection.text} />
                </blockquote>
                <label>
                    问题
                    <textarea
                        value={title}
                        rows={2}
                        disabled={busy || active}
                        onInput={(event) => { setTitle(event.currentTarget.value); setAnswerPlan(undefined); }}
                    />
                </label>
                {!preferences.autoApplyPlan && answerPlan && (
                    <details data-testid="readweave-follow-up-plan" open={!job}>
                        <summary>回答流程</summary>
                        <label>目标<input value={answerPlan.objective ?? ""} disabled={busy || active}
                            onInput={event => setAnswerPlan({ ...answerPlan, objective:event.currentTarget.value })} /></label>
                        {([
                            ["answerRequirements", "必答项"], ["exclusions", "排除项"],
                            ["steps", "流程步骤"], ["searchQueries", "检索词"]
                        ] as const).map(([field,label]) => (
                            <label key={field}>{label}<textarea rows={3} value={(answerPlan[field] ?? []).join("\n")}
                                disabled={busy || active} onInput={event => setAnswerPlan({
                                    ...answerPlan, [field]:splitPlanLines(event.currentTarget.value)
                                })} /></label>
                        ))}
                    </details>
                )}
                <button
                    type="button"
                    class="btn btn-secondary"
                    disabled={busy || active || !title.trim()
                        || parent.depth >= READWEAVE_MAX_FOLLOW_UP_DEPTH}
                    onClick={() => void generate()}
                >
                    {!preferences.autoApplyPlan && !answerPlan ? "生成流程计划" : "生成回答"}
                </button>
                {active && (
                    <button
                        type="button"
                        class="btn btn-outline-danger"
                        disabled={busy}
                        onClick={() =>
                            void action(async () => {
                                if (job)
                                    accept(
                                        (
                                            await server.patch<{ job: ReadWeaveGenerationJob }>(
                                                `readweave/generation-jobs/${encodeURIComponent(job.jobId)}/cancel`,
                                                {},
                                            )
                                        ).job,
                                    );
                            })
                        }
                    >
                        中断生成
                    </button>
                )}
                {job?.result?.body && (
                    <ReadWeaveAnswer
                        body={job.result.body}
                        followUpLabel={job.savedLinkId ? "追问" : "保存并追问"}
                        onFollowUp={
                            level < READWEAVE_MAX_FOLLOW_UP_DEPTH
                                ? (selected) => void saveAndFollowUp(selected)
                                : undefined
                        }
                    />
                )}
                {job?.status === "ready-for-review" && (
                    <button
                        type="button"
                        class="btn btn-secondary"
                        disabled={busy}
                        onClick={() => void saveAndFollowUp()}
                    >
                        保存回答
                    </button>
                )}
                {job?.status === "saved" && <small>已保存</small>}
                {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
                {active && <small role="status">正在生成</small>}
            </div>
        </section>,
        document.body,
    );
}
