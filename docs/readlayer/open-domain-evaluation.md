# Open-domain evaluation fixtures

Version `1.0.0` provides **100 independently authored base cases**, grouped into 20 content families: 60 dev cases and 40 holdout cases. The fixture module is [readweave_open_domain_cases.ts](../../apps/server/src/services/readweave_open_domain_cases.ts). Main owns runner integration and real model evaluation; this delivery supplies data and the evaluation contract.

The questions, contexts, reference obligations and failure claims were written for this corpus, without deriving them from production classifier outputs, term catalogs, generated answers or the existing quality-case expectations. These are original synthetic scenarios and teaching examples, not captured production requests or imported benchmark rows. Known regression terms supplied by the user are the explicit exception to new topic selection: `od-001` 异构, `od-002` 内核, `od-003` 解析布局 and `od-004` 面面对混合键合. Their surrounding requests are synthetic reconstructions. The last preserves the supplied typo and provides a caption supporting the likely intended reading.

## Integration contract

The module has no imports, provider calls, runner registration, classifier labels, expected intent, generated paraphrases or reference-answer strings. It exports:

- `ReadWeaveOpenDomainCase`: the interface below.
- `READWEAVE_OPEN_DOMAIN_CORPUS_VERSION`: `1.0.0`.
- `READWEAVE_OPEN_DOMAIN_CASES`: all 100 literal base records.
- `READWEAVE_OPEN_DOMAIN_DEV_CASES`: the 60 dev records.
- `READWEAVE_OPEN_DOMAIN_HOLDOUT_CASES`: the 40 holdout records.

```typescript
interface ReadWeaveOpenDomainCase {
    id: string;
    family: string;
    split: "dev" | "holdout";
    slices: string[];
    question: string;
    context: string;
    requiredConcepts: string[];
    forbiddenConcepts: string[];
    expectedTasks: string[];
}
```

`family` is the content and derivation isolation group. `slices` are overlapping analysis tags; neither belongs in production routing. `context` is a complete plain-text scenario, sometimes containing a selection, dialogue, code, table, source IDs, dates or an explicitly missing input. All named organizations, people, records and measurements in the scenarios are fictional. Normal programming, language and mathematical semantics apply as specified in each exercise. Dates and software versions refer to the scenario, not today's world.

Each `requiredConcepts` item is a semantic obligation. Each `forbiddenConcepts` item describes an incorrect assertion or behavior: mentioning it to reject it is allowed. Each `expectedTasks` item is an independently specified answer obligation, not a mandatory internal planning step. Equivalent language, notation, ordering and valid alternative code fixes are acceptable. Reference descriptions are mostly English even when the question requests Chinese; they are evaluator metadata, not the requested answer language.

For Main's existing unified-answer runner, this is the minimal input projection, using the module's `.js` import path under the repository's TypeScript conventions:

```typescript
import { READWEAVE_OPEN_DOMAIN_DEV_CASES } from "./readweave_open_domain_cases.js";

const inputs = READWEAVE_OPEN_DOMAIN_DEV_CASES.map(c => ({
    articleId: `open-domain-${c.id}`,
    anchorId: `question-${c.id}`,
    anchorType: "range" as const,
    kind: "question" as const,
    title: c.question,
    autoApplyPlan: true,
    activeExternalSearch: false,
    autoExternalSearch: false,
    fragments: [{ id: `context-${c.id}`, role: "document" as const, text: c.context }]
}));
```

Keep the original question and entire context in the model input. Never send reference concepts, tasks, split or slice metadata to the answering model. If a runner needs separate native selections or conversation turns, make that projection explicit and preserve all information; this minimal projection measures reading the supplied textual scenario. It does not validate native DOM selection offsets, cache isolation or multi-turn persistence merely by describing those conditions in text. Clone records before making variants; the filtered exports share their underlying record objects.

Use search disabled for the base corpus, including provider-native browsing: the fictional records are the evidence, and several questions expressly prohibit outside lookup. Freshness cases test effective dates, snapshot sufficiency, version scope and honest uncertainty. They do **not** test a real search engine's ability to discover today's facts. Main may add a separately reported retrieval mode with frozen synthetic source packets and externally controlled failure injection; do not silently change these questions into live-world lookups.

## Fixed split and coverage

Every row below contains five independently written questions and contexts. No base case is a generated suffix, translation or renamed duplicate of another base case. Broader reasoning skills deliberately occur in both splits; sharing a skill does not make two independently specified scenarios derivatives.

| Content family | IDs | Split |
| --- | --- | --- |
| chip-reading-regressions | od-001–005 | dev |
| author-pollution-software | od-006–010 | dev |
| dependency-logistics | od-011–015 | dev |
| dated-civic-records | od-016–020 | dev |
| everyday-ambiguity | od-021–025 | dev |
| unicode-text-identity | od-026–030 | dev |
| quantities-and-rates | od-031–035 | dev |
| javascript-state | od-036–040 | dev |
| survey-tables | od-041–045 | dev |
| causal-premises | od-046–050 | dev |
| editorial-terminology | od-051–055 | dev |
| local-workflow-definitions | od-056–060 | dev |
| archive-entity-identity | od-061–065 | holdout |
| dialogue-referents | od-066–070 | holdout |
| materials-mechanisms | od-071–075 | holdout |
| provenance-and-support | od-076–080 | holdout |
| versioned-instrument-records | od-081–085 | holdout |
| cross-language-interpretation | od-086–090 | holdout |
| numerical-program-reasoning | od-091–095 | holdout |
| fieldbook-local-measures | od-096–100 | holdout |

Required slices, with overlapping base-case counts: technical definitions 14; author pollution 12; compound 27; multi-hop 12; freshness 12; ambiguity 27; multilingual/Unicode 13; math 28; code 11; table 11; false premises 23; named entities 13; terminology 18; article-defined terms 11; coreference 9. Additional tags cover partial answers, source support, embedded instructions, textual state changes and missing visual evidence. Counts are descriptive, not a claim of comprehensive language or domain coverage.

Any future paraphrase, translation, author insertion/removal, renamed entity, reordered context, alternate selection, cache run or other derivative inherits its base ID and family split. Keep a variant-to-base mapping in runner results and score base families, not inflated variant counts. If two families later share a source article or become derivatives, merge their isolation group before evaluation. Do not randomly split expanded rows. No training split exists, and neither partition may become a classifier keyword list or training corpus.

Use dev for implementation and judge calibration. Freeze model, prompts, adapter, reference version and scoring rules before the holdout run. Holdout is visible in this repository, so it is an operationally reserved evaluation partition, not a secret or demonstrably uncontaminated benchmark. If its answers inform tuning, disclose that exposure and stop presenting that version as untouched holdout. Future stronger generalization claims need newly authored, access-controlled families. The current split prevents authored derivatives from crossing partitions; it cannot establish absence of pretraining contamination.

## Three separate forms of evidence

**Fixture integrity:** check the 100 IDs, 100 distinct questions and contexts, nonempty string fields and arrays, 20 families with five members each, the 60/40 split, all required slice tags and zero family overlap. These checks validate the fixture asset, not answer quality. Unique strings alone cannot prove semantic independence; the family design and review remain necessary.

**Mock structural evaluation:** mocked planner, writer or search responses can establish that original inputs reach the writer, invalid suggestions fall back, requests obey search permissions, required references exist and budget or writer routing remains independent of semantic labels. Trace actual calls to prove such properties. A mock built from `requiredConcepts`, or a test that merely checks the case's metadata, provides no evidence that a model understands the question. A mock returning an expected answer is never a semantic pass.

**Real model semantic evaluation:** call the actual configured answering model with question and context only; retain its actual final answer and execution trace. Score against these independent references. A real provider call with frozen or mocked retrieval is a real model result under controlled evidence, not a live retrieval result. A provider failure, skipped call or missing credential is recorded as an execution outcome, not converted into a passed semantic case. No real model run was performed as part of authoring this corpus.

### Semantic scoring

For each answer, annotate every required concept and expected task as `met`, `partial`, `unmet` or `unjudged`, with a short answer span and rationale. Mark each forbidden claim or behavior as present or absent, considering negation and attribution. A strict case pass requires every required concept and task to be met, no forbidden violation, and no independently detected unsupported material claim. Unjudged cases cannot pass.

Do not use `answer.includes(concept)`, exact answer equality, minimum keyword counts, reference-array echoing, or the model's self-declared task list as a semantic oracle. For example, rejecting “the room is open” is correct in `od-017`; a banned-substring check would penalize that correction. A translated explanation can satisfy an English reference. Valid units and equivalent mathematical notation should be accepted.

Calculate independently specified task coverage as met tasks divided by the number of fixture tasks, reporting partial and unjudged counts separately. Also report required-concept coverage, strict case pass rate, target drift, false whole-answer abandonment on answerable portions, unsupported claims, and date/version errors. Cite-support cases need separate judgments for reference existence and support for the specific claim. An explicit uncertainty answer can be correct when the source is missing; do not equate it with erroneous refusal. For `od-069`, requesting the missing referent is the expected task.

Use deterministic numeric or code checks where the question fixes a value, type, order or unit; those checks establish that component only. Review the accompanying explanation, omissions and unsupported claims separately. A semantic judge may assist after human calibration on dev; keep it separate from the answering model's own plan, ask for evidence spans, and adjudicate ambiguous judgments. The present references were authored independently of system output, but are not a claim of multi-annotator human agreement.

Report dev and holdout separately, including evaluated/total cases and per-slice sample sizes. Include case-weighted and family-macro results. For uncertainty intervals or repeated runs, resample whole families with all their variants together; do not treat related variants as independent observations. A small live subset is a smoke evaluation, not a score for the full corpus. Predeclare the subset before inspecting answers.

Main's live run record should include corpus version, case and family IDs, split, input projection, actual answer, per-obligation judgments, provider/model version, prompts/configuration, search mode, timestamps, repetitions, call count, token usage, latency, known cost, unsettled cost and execution errors. Use the existing explicit live-evaluation configuration path; credentials do not belong in the fixture or reports. Compare candidate and direct-question/context baseline under the same evidence and budget settings. This document introduces no new runner command or automatic paid invocation.

## Method sources and data boundaries

The supplied ReadWeave architecture review, especially its sections 11–12, motivates independent obligations, author-distraction regressions and splitting by base question/article/variant family. Its reference code and claimed test results are not evidence that this repository passes them. Read-only inspection found that the existing `readweave_quality_cases.ts` expands seeds with wording templates and includes related dev/holdout concepts; this new corpus is separately authored and does not change that module.

The following primary sources were consulted on 2026-09-15. Only evaluation methods are adopted; no benchmark questions, answers, documents, screenshots, source code or downloaded dataset rows are included.

| Primary source | Method adopted here | Asset status |
| --- | --- | --- |
| [AmbigQA, Min et al., EMNLP 2020](https://aclanthology.org/2020.emnlp-main.466/) | Represent plausible interpretations and their separate answers when context cannot disambiguate | Method only; no AmbigNQ/Natural Questions data imported; data reuse license not cleared here |
| [HotpotQA, Yang et al., EMNLP 2018](https://aclanthology.org/D18-1259/) | Require the intermediate evidence links and comparison, not just a guessed endpoint | Method only; the [official dataset page](https://hotpotqa.github.io/) labels its data CC BY-SA 4.0; no data imported |
| [FreshLLMs / FreshQA, Vu et al.](https://arxiv.org/abs/2310.03214) | Evaluate time-sensitive questions and false premises; distinguish a supported partial answer from fabricated certainty | Method only; the [official repository](https://github.com/freshllms/freshqa) displays Apache-2.0; linked spreadsheet snapshots and third-party contents were not imported or independently licensed here |
| [ALCE, Gao et al., EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/) | Judge answer correctness and citation support separately | Method only; no retrieval corpus or benchmark rows imported; data reuse license not cleared here |

Before any future external data import, check the exact asset and version, license, attribution/share-alike or use restrictions, and third-party source-content rights. A code repository's license does not automatically clear every linked dataset or document. These method citations do not relicense third-party material or assert that the corpus reproduces official benchmark scores.

## Delivery validation and limits

The fixture passed direct module loading and structural checks for 100 unique IDs/questions/contexts, all required fields and slices, four regression markers, 20 disjoint five-case families, and a 60/40 split. A standalone strict TypeScript check with no output emission is the module-level compilation check. Main still owns test-runner integration, fault-injection tests and real model semantic runs; structural validation supplies no model accuracy result.

This is a modest, mostly text-based, supplied-evidence sample of open-domain failure modes. It does not establish universal coverage, native image understanding, broad multilingual fluency, exhaustive software semantics, real entity knowledge, current web retrieval quality, production state isolation, or actual UTF-16 anchor extraction. `od-100` checks honesty when visual evidence is missing, not perception of an image. Those claims require their own inputs, execution traces and evaluation runs.

## Full-suite skip audit and final local result (2026-09-15)

The final full server run passed **5,802 tests with 135 existing skips and zero failures** across 358 passing files and seven skipped files. The earlier local triage artifact recorded 5,455 passes and eight failures before the focused fixes; it is ignored local output and is not a committed fixture. Skips are not passes, and a zero-failure run with documented skips does not establish universal coverage.

| Skipped group (paths under `apps/server/src`) | Count | Reason and disposition |
| --- | ---: | --- |
| `services/readweave_unified_ai.spec.ts`: retired multi-stage workflow | 43 | Explicit `describe.skip`. Fixed verifier stages, catalog safety-answer substitution and fixed search ordering are retired behavior, not new-root acceptance requirements. Still-active assertions mixed into this block need selective porting; see gaps below. |
| `services/readweave_ai.live.spec.ts` | 10 | Opt-in `READWEAVE_LIVE_AI=1`; no real-provider result in this run. |
| `services/readweave_person_profile.live.spec.ts` | 7 | Same live gate. |
| `services/readweave_real_world.live.spec.ts` | 13 | Same live gate. |
| `services/readweave_unified_quality.live.spec.ts` | 20 | Same live gate: definition matrix 13, QA/definition parity 2, selected bilingual identity 2, mixed-name repair 3. |
| `services/readweave_balance_benchmark.live.spec.ts` | 1 | Opt-in `READWEAVE_BENCHMARK_AI=1`. |
| `services/search/services/search_benchmark.spec.ts`: Comprehensive Search Benchmark | 26 | Unconditional `describe.skip`; synthetic search-performance scenarios, **not** an opt-in live suite. Functional search tests do not replace timing/scaling coverage. |
| `services/search/services/search_profiling.spec.ts`: Search Profiling | 15 | `describe.runIf(process.env.RUN_SEARCH_PROFILING)`; synthetic CPU/profiling scenarios, not provider evaluation. |

The total reconciles as **43 retired + 51 opt-in live/benchmark + 41 search-performance = 135**. No skips were added or tests removed for this audit.

### Active evidence and remaining gaps

Counts below identify the relevant active suites; an active helper test is not automatically end-to-end coverage.

| Requirement formerly mixed with compatibility tests | Active evidence | Limit |
| --- | --- | --- |
| Original question/context reaches the writer; author distraction cannot replace the task | `readweave_open_domain_pipeline.spec.ts` (205 passed), plus active wrapper/context regressions in `readweave_generation_jobs.spec.ts` (42 passed) | Mock transport and structural assertions, not model comprehension. |
| Bounded calls, search permissions and durable retry allowance | `readweave_budget.spec.ts`, `readweave_durable_budget.spec.ts`, jobs, `readweave_search.spec.ts` and `readweave_research.spec.ts` passed in the final full run | Unit coverage establishes the encoded invariants, not provider billing accuracy or live-search relevance. |
| Generic grammar, bilingual identity and output format | `readweave_ai.spec.ts` (63), `readweave_format.spec.ts` (135), `readweave_unified_quality.spec.ts` (127) passed | Some assertions exercise legacy helpers; these counts do not establish new-root semantic quality. |
| Explicit exclusions and source references survive planning | `readweave_answer_plan.spec.ts` preserves original exclusions; `readweave_task_contract.spec.ts` (42 passed) checks contract references | Propagation and citation validity do not prove final-answer exclusion compliance or factual entailment. |

The retired workflow remains deliberately excluded rather than presented as a current pass. Its still-relevant behaviors have active equivalents in provider-shape, source-support, exclusion, claim-boundary and unified-generation tests. The final full run is the authoritative local unit/integration result; it does not replace live-provider semantic evaluation.

### Separate production-wrapper live evaluation

The [dedicated evaluation](../../apps/server/evals/readweave_open_domain.eval.ts), [isolated config](../../apps/server/vitest.open-domain-eval.config.mts) and [launcher guide](../../scripts/readweave/open-domain-eval.md) are separate from the skipped compatibility suites. Both candidate and baseline call `generateReadWeaveAnswer` with its actual quality callback and published harness; there are no test-skip declarations in that evaluation. Missing runtime configuration fails an actual live run. However, `--check` deliberately returns before provider execution: two passing runner checks are **not** two semantic passes.

Report selected/evaluated case counts, provider errors and judged outcomes from an actual run. The fictional corpus uses supplied evidence with search disabled; the separate `public-search` suite requires its own retrieval evidence. Neither can inherit a result from skipped legacy live tests or from the offline launcher check. The final pre-publish attempt could not complete this gate because the configured writing provider returned an insufficient-balance response and the configured verifier source also rejected fallback access. This is recorded as an external provisioning blocker, not a semantic pass or product-code failure.
