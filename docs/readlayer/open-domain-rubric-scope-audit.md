# Independent ALL100 rubric scope audit

## Scope and frozen interpretation

Audit version: `root-scope-v1`. Corpus version: `1.0.0`.

This review covers all 100 cases, `od-001` through `od-100`, in [the original case corpus](../../apps/server/src/services/readweave_open_domain_cases.ts): 60 development cases and 40 existing holdout cases. It classifies all 303 `requiredConcepts` and 200 `expectedTasks` items. Separate public-search fixtures are outside this ALL100 audit.

Judgments use only each exact original question and its supplied context. No generated candidate answers, baseline answers, judge decisions, model pass/fail results, or score reports were consulted for this audit. Earlier-answer text already embedded in a fixture's original context is input evidence, not a candidate output consulted by this review.

The original criteria, corpus, test files, evaluator and strict scoring are unchanged. Existing strict scores must remain reportable exactly as originally measured; this document never replaces, rescales, repairs or retroactively turns a strict failure into a pass. A scope concern is not proof that a model answered correctly. No model scores were computed here.

The questions and criteria below retain the tracked synthetic fixture wording. Context-basis notes summarize the full original context used for judgment; they do not replace it or authorize truncating it for generation. No live requests, private documents, provider receipts or raw evaluation reports are reproduced.

## Classification method

- **core-required**: directly requested, or necessary to make the requested answer correct and properly bounded under the supplied context. Necessary calculations, identity distinctions, false-premise corrections, evidence limits, time/version/unit constraints and rejection of embedded unauthorized instructions remain core.
- **helpful-enrichment**: a supported, relevant addition whose omission alone can leave the original request adequately answered. Examples include an unrequested difference, illustration, adjacent mechanism, or explicit warning about a wrong alternative that the answer does not use.
- **unsupported-assumption**: requires adopting a factual premise or obligation not supplied or reasonably entailed by the original question and context. No item met this classification in this review. Ordinary reasoning and directly derivable facts are not unsupported merely because they are not quoted verbatim.

For a mixed item combining a core obligation with an optional addition, the **whole conjunctive item** is classified `helpful-enrichment`; its rationale explicitly preserves the core part. This is not permission to omit that core part. A request for an explanation still requires the decisive reasoning, not just an unexplained yes/no answer.

An optional explicit warning is distinct from a mandatory correctness constraint: not requiring a warning about averaging percentages never allows the wrong average; not requiring a distractor discussion never allows the wrong referent. An otherwise correct answer may satisfy some core constraints implicitly. This audit does not invent compulsory warning prose or reclassify any `forbiddenConcepts`, format, safety or evidence-correctness checks.

## Coverage findings

| Original field | core-required | helpful-enrichment | unsupported-assumption | Total |
| --- | ---: | ---: | ---: | ---: |
| requiredConcepts | 276 | 27 | 0 | 303 |
| expectedTasks | 186 | 14 | 0 | 200 |
| Total | 462 | 41 | 0 | 503 |

These are scope-classification counts, not model scores. Twenty-nine cases contain at least one enrichment or mixed item; the other 71 cases have only core items in these two fields. The development split contains 272 core and 26 enrichment items; the existing holdout split contains 190 core and 15 enrichment items.

All 41 findings concern optional material, including mixed core-plus-optional wording, rather than unsupported factual inventions. Calling all 41 criteria simply invalid would overstate this review.

### Requested spot checks

- `dev015` maps to `od-015`: `required-2` and `tasks-1` mix the core cheaper-route decision with an optional separate savings figure. Both route totals and the correct choice remain required.
- `dev036` maps to `od-036`: `required-2` adds the optional `const`/freezing distinction; `tasks-1` mixes the required result with that optional lesson. Shared-reference reasoning and the resulting value remain required.
- `dev041` maps to `od-041`: `required-2` demands an optional warning against averaging percentages. Correct aggregation of the original counts remains required.

## Independent coreScope mask view

This is an auxiliary **item-filtered view**, named `coreScope`, not a changed evaluator or a new benchmark. Each row below has an explicit mask bit: `1` includes the unchanged original criterion in that auxiliary view; `0` excludes the whole item there. All original items remain included in strict scoring. The compact definition below and the exhaustive table describe the same mask.

```json
{
  "view": "coreScope",
  "auditVersion": "root-scope-v1",
  "corpusVersion": "1.0.0",
  "universe": "od-001..od-100 / requiredConcepts and expectedTasks only",
  "defaultInclude": true,
  "excludedKeys": [
    "od-009/required-1",
    "od-009/tasks-0",
    "od-010/required-1",
    "od-010/tasks-0",
    "od-015/required-2",
    "od-015/tasks-1",
    "od-019/required-1",
    "od-020/tasks-1",
    "od-021/required-2",
    "od-027/required-2",
    "od-030/required-2",
    "od-030/tasks-1",
    "od-033/required-2",
    "od-034/required-1",
    "od-036/required-2",
    "od-036/tasks-1",
    "od-041/required-2",
    "od-042/required-2",
    "od-052/required-2",
    "od-056/required-2",
    "od-057/required-1",
    "od-057/tasks-0",
    "od-058/required-0",
    "od-058/tasks-0",
    "od-059/required-0",
    "od-059/tasks-0",
    "od-065/required-3",
    "od-067/required-0",
    "od-067/tasks-0",
    "od-068/required-2",
    "od-076/required-2",
    "od-078/required-3",
    "od-083/tasks-1",
    "od-085/required-2",
    "od-085/tasks-1",
    "od-088/required-2",
    "od-088/tasks-1",
    "od-091/required-2",
    "od-097/required-3",
    "od-097/tasks-1",
    "od-100/required-1"
  ],
  "originalStrictUnchanged": true,
  "newHoldout": false
}
```

`view` names the optional projection; `auditVersion` and `corpusVersion` identify its fixed interpretation and source version. `universe` limits default inclusion to the 503 keys enumerated here; unknown or changed keys require a new review, not automatic inclusion. `excludedKeys` lists the 41 whole-item exclusions. The final two flags require preserving strict scoring and explicitly reject a new-holdout claim.

For a later comparison, main/Banach can apply this frozen mask to the same original per-item judgments for both systems, without changing criterion wording or rejudging to favor either system. Keep original strict results first, show the auxiliary field-level numerator and denominator separately, preserve all original correctness/forbidden checks, and mark absent judgments unavailable rather than passed. Do not infer an aggregate pass threshold or carry over a strict aggregate threshold to this smaller item set.

**Important limitation:** excluding mixed items also removes their core sub-obligations from that item-filtered score unless another retained item covers them. Therefore this mask is not a complete test of original-request satisfaction and cannot by itself establish a “core-complete” answer or a case-level pass. The mixed-item rationales must accompany interpretation; checking those residual obligations separately would be a separately labeled assessment, not a silent rewrite of the existing criteria.

This review covers the already exposed development and holdout inputs. Outcome-independent review of existing inputs does not create unseen data, a new split, or a fresh holdout. Keep the existing split names and disclose this post-construction scope audit in any comparison. Freeze this version before inspecting comparison outputs; any later scope revision must be explicit, versioned and justified from the original input rather than a system's result.

## Every-case audit

Keys are zero-based, matching `required-N` and `tasks-N` in the evaluator, prefixed with the original case ID. Original criterion text is reproduced without semantic edits. For a core row, “Core under the question/context basis above” means the criterion supplies a requested result or a necessary constraint identified by that case's question and context; every non-core row has a specific rationale.

### od-001 · dev

Original question:

> 这里的异构是什么意思？指出材料中的两种差异。

Context basis: Computation and sensing dies use processes P and Q inside one package; the author card is background.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-001/required-0` | Heterogeneity concerns combining dissimilar components in this package | core-required | 1 | Core under the question/context basis above. |
| `od-001/required-1` | The dies differ in function: computation versus sensing | core-required | 1 | Core under the question/context basis above. |
| `od-001/required-2` | The dies also use different fabrication processes P and Q | core-required | 1 | Core under the question/context basis above. |
| `od-001/tasks-0` | Explain the selected technical term in the packaging context | core-required | 1 | Core under the question/context basis above. |
| `od-001/tasks-1` | Identify both the functional and process differences stated in the passage | core-required | 1 | Core under the question/context basis above. |

### od-002 · dev

Original question:

> 这里的内核负责什么？应用怎样请求它的服务？

Context basis: Three operating-system responsibilities and the system-call interface are explicitly supplied.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-002/required-0` | Kernel denotes the operating system component in this passage | core-required | 1 | Core under the question/context basis above. |
| `od-002/required-1` | Its responsibilities include process scheduling, virtual memory and device access | core-required | 1 | Core under the question/context basis above. |
| `od-002/required-2` | Applications request services through system calls | core-required | 1 | Core under the question/context basis above. |
| `od-002/tasks-0` | Explain all three stated responsibilities of this kernel | core-required | 1 | Core under the question/context basis above. |
| `od-002/tasks-1` | Describe the application-to-kernel service boundary | core-required | 1 | Core under the question/context basis above. |

### od-003 · dev

Original question:

> 解析布局在这段里怎样确定单元位置？优化后就一定没有重叠了吗？

Context basis: Continuous coordinates optimize wire length and density; a later legalization step handles remaining overlaps.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-003/required-0` | Analytical placement optimizes continuous cell coordinates | core-required | 1 | Core under the question/context basis above. |
| `od-003/required-1` | Both wire length and density contribute to the objective | core-required | 1 | Core under the question/context basis above. |
| `od-003/required-2` | A later legalization stage resolves remaining overlaps and placement constraints | core-required | 1 | Core under the question/context basis above. |
| `od-003/tasks-0` | Explain the optimization variables and objectives | core-required | 1 | Core under the question/context basis above. |
| `od-003/tasks-1` | Separate global placement from the stated legalization guarantee | core-required | 1 | Core under the question/context basis above. |

### od-004 · dev

Original question:

> “面面对混合键合”是指什么？这里为什么同时提到铜和介质？

Context basis: The adjacent caption supplies 面对面; front-to-front alignment combines copper connections with dielectric bonding.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-004/required-0` | The duplicated character in the selection is a likely typo supported by the adjacent caption | core-required | 1 | Core under the question/context basis above. |
| `od-004/required-1` | The chip fronts face one another | core-required | 1 | Core under the question/context basis above. |
| `od-004/required-2` | Copper forms metal connections while surrounding dielectric surfaces also bond | core-required | 1 | Core under the question/context basis above. |
| `od-004/tasks-0` | State the context-supported reading of the typo without claiming certainty beyond the caption | core-required | 1 | Core under the question/context basis above. |
| `od-004/tasks-1` | Explain the face orientation and the two bonding constituents | core-required | 1 | Core under the question/context basis above. |

### od-005 · dev

Original question:

> 这组封装实验的端到端延迟是多少？仅优化芯片计算能否达到 7 ns？

Context basis: Three nonnegative serial delays are 3, 4 and 5 ns; only the middle delay may change.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-005/required-0` | Serial end-to-end latency is 12 ns | core-required | 1 | Core under the question/context basis above. |
| `od-005/required-1` | The two fixed interconnect stages already total 8 ns | core-required | 1 | Core under the question/context basis above. |
| `od-005/required-2` | A 7 ns target is impossible by reducing computation alone | core-required | 1 | Core under the question/context basis above. |
| `od-005/tasks-0` | Sum the serial stage delays with units | core-required | 1 | Core under the question/context basis above. |
| `od-005/tasks-1` | Derive the fixed-delay lower bound and assess the target | core-required | 1 | Core under the question/context basis above. |

### od-006 · dev

Original question:

> Explain what the tombstone does here and when it can be removed.

Context basis: A deletion marker hides older values; removal is conditional on excluding their resurrection.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-006/required-0` | A tombstone represents deletion while older versions may still exist | core-required | 1 | Core under the question/context basis above. |
| `od-006/required-1` | It prevents an older value from becoming visible again | core-required | 1 | Core under the question/context basis above. |
| `od-006/required-2` | Removal depends on excluding resurrection from retained older data | core-required | 1 | Core under the question/context basis above. |
| `od-006/tasks-0` | Explain the marker's role in reads | core-required | 1 | Core under the question/context basis above. |
| `od-006/tasks-1` | State the supplied condition for safe removal | core-required | 1 | Core under the question/context basis above. |

### od-007 · dev

Original question:

> What does this code log, and why does the comment not determine the result?

Context basis: The filter keeps 5 and 8 from [2, 5, 8]; the author's comment is non-executable.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-007/required-0` | The logged number is 2 | core-required | 1 | Core under the question/context basis above. |
| `od-007/required-1` | Only 5 and 8 pass the predicate | core-required | 1 | Core under the question/context basis above. |
| `od-007/required-2` | A JavaScript comment does not execute or override the expression | core-required | 1 | Core under the question/context basis above. |
| `od-007/tasks-0` | Trace the filter and count the surviving values | core-required | 1 | Core under the question/context basis above. |
| `od-007/tasks-1` | Explain why the author-bearing comment has no execution effect | core-required | 1 | Core under the question/context basis above. |

### od-008 · dev

Original question:

> Does this lease allow a worker to act forever? Explain the limit.

Context basis: The grant expires at 14:05 UTC and renewal requires server approval, not a worker's belief.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-008/required-0` | The access grant expires at 14:05 UTC unless the server approves renewal | core-required | 1 | Core under the question/context basis above. |
| `od-008/required-1` | A local assumption of renewal is insufficient | core-required | 1 | Core under the question/context basis above. |
| `od-008/required-2` | The lease is time-limited rather than perpetual authority | core-required | 1 | Core under the question/context basis above. |
| `od-008/tasks-0` | Answer whether authority is perpetual | core-required | 1 | Core under the question/context basis above. |
| `od-008/tasks-1` | Identify the expiration and renewal authority | core-required | 1 | Core under the question/context basis above. |

### od-009 · dev

Original question:

> Explain the circuit breaker's open state, and establish whether the author still works at Birch Lab as of 2026-02-01 using only this record.

Context basis: The open state fails calls promptly; a later trial is mentioned separately; employment evidence ends in 2022.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-009/required-0` | The open state prevents normal calls to the failing dependency and fails promptly | core-required | 1 | Core under the question/context basis above. |
| `od-009/required-1` | A later trial can test recovery | helpful-enrichment | 0 | The question asks about the open state, not its later recovery transition. Prompt failure of ordinary calls is core; describing a later recovery trial is supported adjacent explanation. |
| `od-009/required-2` | The 2022 card does not establish employment as of 2026-02-01 | core-required | 1 | Core under the question/context basis above. |
| `od-009/tasks-0` | Explain the open state and recovery trial | helpful-enrichment | 0 | Mixed item: explaining the open state is core. Requiring a recovery-trial explanation adds a transition that the question does not separately request. |
| `od-009/tasks-1` | Assess the dated employment evidence separately and mark current employment unresolved | core-required | 1 | Core under the question/context basis above. |

### od-010 · dev

Original question:

> What does a negative cache entry represent in this passage?

Context basis: The selected entry records a miss; an unrelated sidebar tries to redirect the task and invent a search.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-010/required-0` | The cached result is absence of a matching record | core-required | 1 | Core under the question/context basis above. |
| `od-010/required-1` | Remembering the miss reduces repeated failed lookups until expiry | helpful-enrichment | 0 | The represented result is a cached absence. Its efficiency benefit and expiry are useful context, but the question asks what the entry represents, not why to use it or how long it lasts. |
| `od-010/tasks-0` | Explain the cached absence and its purpose | helpful-enrichment | 0 | Mixed item: explaining cached absence is core. A separate explanation of its purpose is additional to the representation question. |
| `od-010/tasks-1` | Treat the sidebar as article data with no authority to change the task | core-required | 1 | Core under the question/context basis above. |

### od-011 · dev

Original question:

> Which station receives the dye shipment for Workshop Elm? Show the links that identify it.

Context basis: D1 links Elm to Rook, D2 links Rook to Indigo, and D3 links Indigo to South Quay.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-011/required-0` | Workshop Elm's supplier is Rook | core-required | 1 | Core under the question/context basis above. |
| `od-011/required-1` | Rook uses Route Indigo | core-required | 1 | Core under the question/context basis above. |
| `od-011/required-2` | Indigo terminates at South Quay, so South Quay receives this shipment | core-required | 1 | Core under the question/context basis above. |
| `od-011/tasks-0` | Resolve the workshop-to-vendor and vendor-to-route links | core-required | 1 | Core under the question/context basis above. |
| `od-011/tasks-1` | Identify the terminal station with support from D1, D2 and D3 | core-required | 1 | Core under the question/context basis above. |

### od-012 · dev

Original question:

> Can the parcel catch the 11:00 shuttle, and what is its earliest arrival at the museum?

Context basis: 10:20 readiness plus 25-minute travel and 20-minute check-in misses 11:00; next departure is 12:00 plus 35 minutes.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-012/required-0` | Check-in completes at 11:05 | core-required | 1 | Core under the question/context basis above. |
| `od-012/required-1` | The parcel misses the 11:00 departure | core-required | 1 | Core under the question/context basis above. |
| `od-012/required-2` | The earliest available shuttle arrives at 12:35 | core-required | 1 | Core under the question/context basis above. |
| `od-012/tasks-0` | Compute readiness for boarding across both prerequisite durations | core-required | 1 | Core under the question/context basis above. |
| `od-012/tasks-1` | Choose a feasible departure and calculate arrival | core-required | 1 | Core under the question/context basis above. |

### od-013 · dev

Original question:

> Which container can carry lot Vela, and why is the other one unsuitable?

Context basis: Both containers fit the sleeve; only Cedar stays below 8 degrees C.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-013/required-0` | Both containers fit the required sleeve | core-required | 1 | Core under the question/context basis above. |
| `od-013/required-1` | Cedar satisfies the below-8-degree requirement | core-required | 1 | Core under the question/context basis above. |
| `od-013/required-2` | Flint fails the temperature requirement despite mechanical compatibility | core-required | 1 | Core under the question/context basis above. |
| `od-013/tasks-0` | Join the lot requirement to the compatibility card | core-required | 1 | Core under the question/context basis above. |
| `od-013/tasks-1` | Apply the independent temperature constraint to choose and reject containers | core-required | 1 | Core under the question/context basis above. |

### od-014 · dev

Original question:

> Identify the carrier and final port for crate 17, distinguishing what is known from what is missing.

Context basis: Crate 17 links through Z8 to Moss Freight, but the destination itinerary Kappa is absent.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-014/required-0` | The carrier is Moss Freight via booking Z8 | core-required | 1 | Core under the question/context basis above. |
| `od-014/required-1` | The final port cannot be established without itinerary Kappa | core-required | 1 | Core under the question/context basis above. |
| `od-014/required-2` | Multiple routes prevent inferring one port from the carrier alone | core-required | 1 | Core under the question/context basis above. |
| `od-014/tasks-0` | Resolve the supported carrier link | core-required | 1 | Core under the question/context basis above. |
| `od-014/tasks-1` | Identify the specific missing itinerary evidence and leave only the port unresolved | core-required | 1 | Core under the question/context basis above. |

### od-015 · dev

Original question:

> For 40 identical boxes, compare the total charge for the two routes and choose the cheaper one.

Context basis: The complete eligible-route tariffs are 40×3+25 and 40×4; both meet the non-price constraints.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-015/required-0` | Pine costs 40 times 3 plus 25, or 145 credits | core-required | 1 | Core under the question/context basis above. |
| `od-015/required-1` | Reed costs 160 credits | core-required | 1 | Core under the question/context basis above. |
| `od-015/required-2` | Pine is cheaper by 15 credits under the stated complete fee schedule | helpful-enrichment | 0 | Mixed item: identifying Pine as cheaper is core after the requested totals 145 and 160. Explicitly calculating or stating the 15-credit saving is optional comparison detail, not another question. |
| `od-015/tasks-0` | Calculate each full route cost | core-required | 1 | Core under the question/context basis above. |
| `od-015/tasks-1` | Compare totals and state the cheaper route and savings | helpful-enrichment | 0 | Mixed item: compare the totals and choose Pine (core). Reporting a separate savings amount extends the requested comparison; omitting that amount must not excuse wrong totals or a wrong choice. |

### od-016 · dev

Original question:

> Who chaired the fictional harbor council on 2025-07-01? Distinguish announcement from taking office.

Context basis: Bela's tenure covers July 1; Arin's announced replacement becomes effective only on July 15.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-016/required-0` | Bela remains chair on 2025-07-01 | core-required | 1 | Core under the question/context basis above. |
| `od-016/required-1` | Arin's effective start is 2025-07-15 | core-required | 1 | Core under the question/context basis above. |
| `od-016/required-2` | Publication on June 20 does not make the appointment effective that day | core-required | 1 | Core under the question/context basis above. |
| `od-016/tasks-0` | Resolve the officeholder at the requested date | core-required | 1 | Core under the question/context basis above. |
| `od-016/tasks-1` | Explain the difference between notice publication and effective appointment | core-required | 1 | Core under the question/context basis above. |

### od-017 · dev

Original question:

> Is the east reading room open on 2025-10-04? Use the dated notices and explain the conflict.

Context basis: The October 3–6 maintenance closure is more specific than the January schedule; the mirror merely repeats that old schedule.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-017/required-0` | The room is closed on October 4 under the maintenance notice | core-required | 1 | Core under the question/context basis above. |
| `od-017/required-1` | The specific dated closure qualifies the routine opening schedule | core-required | 1 | Core under the question/context basis above. |
| `od-017/required-2` | A later retrieval of an older mirror does not supersede the maintenance notice | core-required | 1 | Core under the question/context basis above. |
| `od-017/tasks-0` | Apply the closure interval to the requested date | core-required | 1 | Core under the question/context basis above. |
| `od-017/tasks-1` | Resolve the conflict using source scope and publication dates rather than fetch time | core-required | 1 | Core under the question/context basis above. |

### od-018 · dev

Original question:

> As of 2026-01-15, what is the current admission price, and what price is actually documented here? Do not browse.

Context basis: A dated 2023 price of 12 tokens is available, but no evidence fixes the price at the requested 2026 date.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-018/required-0` | The documented 2023 adult price is 12 tokens | core-required | 1 | Core under the question/context basis above. |
| `od-018/required-1` | The current 2026 price is not established by the supplied leaflet | core-required | 1 | Core under the question/context basis above. |
| `od-018/required-2` | Answering the historical amount remains possible | core-required | 1 | Core under the question/context basis above. |
| `od-018/tasks-0` | Report the price with its historical date | core-required | 1 | Core under the question/context basis above. |
| `od-018/tasks-1` | Mark the requested current tariff unverified using the supplied evidence boundary | core-required | 1 | Core under the question/context basis above. |

### od-019 · dev

Original question:

> At the query instant, has the permit window closed? Show the time-zone conversion.

Context basis: The explicit −08:00 offset makes 01:30 equal 09:30 UTC; the exclusive closing instant is 09:00.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-019/required-0` | 01:30 at UTC−08:00 corresponds to 09:30 UTC | core-required | 1 | Core under the question/context basis above. |
| `od-019/required-1` | The query is 30 minutes after closing | helpful-enrichment | 0 | The requested conversion to 09:30 UTC and comparison with 09:00 establish that the window is closed. A separate 30-minute lateness calculation is supported but not requested. |
| `od-019/required-2` | The window has closed at that instant | core-required | 1 | Core under the question/context basis above. |
| `od-019/tasks-0` | Convert the query instant using the explicit offset | core-required | 1 | Core under the question/context basis above. |
| `od-019/tasks-1` | Compare instants and apply the closing rule | core-required | 1 | Core under the question/context basis above. |

### od-020 · dev

Original question:

> Did the 2025 river exhibition actually open on June 8? Separate the planned date from the recorded event.

Context basis: June 8 was scheduled, June 7 postponed it, and a June 14 log records an actual June 12 opening.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-020/required-0` | June 8 was the planned date | core-required | 1 | Core under the question/context basis above. |
| `od-020/required-1` | The postponement invalidates treating the plan as the event | core-required | 1 | Core under the question/context basis above. |
| `od-020/required-2` | The recorded first public opening is June 12 | core-required | 1 | Core under the question/context basis above. |
| `od-020/tasks-0` | Check the proposed event date against the later records | core-required | 1 | Core under the question/context basis above. |
| `od-020/tasks-1` | Report the actual recorded opening and distinguish its publication date | helpful-enrichment | 0 | Mixed item: the recorded June 12 opening is core. Explicitly contrasting that event with the visitor log's June 14 publication adds a date comparison beyond the requested planned-versus-actual distinction. |

### od-021 · dev

Original question:

> Which bank does the passage mean, and what clue resolves it?

Context basis: The selected walking sentence names a stream, reeds and water; the savings advertisement is separate.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-021/required-0` | Bank refers to the land alongside the stream | core-required | 1 | Core under the question/context basis above. |
| `od-021/required-1` | The water, reeds and walking path disambiguate the selected passage | core-required | 1 | Core under the question/context basis above. |
| `od-021/required-2` | The separate savings advertisement does not change the referent | helpful-enrichment | 0 | Resolving bank as the stream-side land and citing water/reeds/path are core. Explicitly discussing the unrelated savings advertisement is optional; selecting a financial referent remains incorrect. |
| `od-021/tasks-0` | Resolve the word in its sentence | core-required | 1 | Core under the question/context basis above. |
| `od-021/tasks-1` | Identify the contextual evidence that selects the river-side meaning | core-required | 1 | Core under the question/context basis above. |

### od-022 · dev

Original question:

> When did Meridian open?

Context basis: Two unrelated venues have the same name, with cinema 1998 and garden 2011 opening dates.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-022/required-0` | Meridian is ambiguous between the cinema and botanical garden | core-required | 1 | Core under the question/context basis above. |
| `od-022/required-1` | The cinema's opening year is 1998 | core-required | 1 | Core under the question/context basis above. |
| `od-022/required-2` | The garden's opening year is 2011 | core-required | 1 | Core under the question/context basis above. |
| `od-022/required-3` | The answer must distinguish the two interpretations or request the venue while presenting those alternatives | core-required | 1 | Core under the question/context basis above. |
| `od-022/tasks-0` | Expose the two plausible referents | core-required | 1 | Core under the question/context basis above. |
| `od-022/tasks-1` | Associate each supplied opening year with its venue | core-required | 1 | Core under the question/context basis above. |

### od-023 · dev

Original question:

> What is the average stall size? Explain if the wording permits more than one statistic.

Context basis: The three areas are 4, 4 and 13 square metres; the question explicitly requests treatment of statistical ambiguity.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-023/required-0` | The arithmetic mean is 7 square metres | core-required | 1 | Core under the question/context basis above. |
| `od-023/required-1` | The median is 4 square metres | core-required | 1 | Core under the question/context basis above. |
| `od-023/required-2` | The selected statistic must be named because average is underspecified here | core-required | 1 | Core under the question/context basis above. |
| `od-023/tasks-0` | Compute the mean and median for the listed values | core-required | 1 | Core under the question/context basis above. |
| `od-023/tasks-1` | Explain the statistical ambiguity using labeled alternatives | core-required | 1 | Core under the question/context basis above. |

### od-024 · dev

Original question:

> Does 'Mina saw the guide with the binoculars' tell us who held the binoculars? Give the possible readings.

Context basis: No attachment cue selects between Mina using binoculars and the guide having them.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-024/required-0` | Mina may have used binoculars to see the guide | core-required | 1 | Core under the question/context basis above. |
| `od-024/required-1` | The guide may instead be the person with binoculars | core-required | 1 | Core under the question/context basis above. |
| `od-024/required-2` | The standalone wording does not establish one holder | core-required | 1 | Core under the question/context basis above. |
| `od-024/tasks-0` | Explain both phrase-attachment readings | core-required | 1 | Core under the question/context basis above. |
| `od-024/tasks-1` | State the unresolved holder without fabricating context | core-required | 1 | Core under the question/context basis above. |

### od-025 · dev

Original question:

> Which umbrella is better for this walk? State the criterion behind the choice.

Context basis: The explicit 25 cm packing priority and light rain favor Fern's 22 cm fold over Rock's 34 cm fold.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-025/required-0` | Fern meets the explicit 25 cm packing limit | core-required | 1 | Core under the question/context basis above. |
| `od-025/required-1` | Fern also meets the expected light-rain use | core-required | 1 | Core under the question/context basis above. |
| `od-025/required-2` | Rock's stronger-wind capability does not resolve its failure of the packing priority | core-required | 1 | Core under the question/context basis above. |
| `od-025/tasks-0` | Use the supplied preference to make a conditional recommendation | core-required | 1 | Core under the question/context basis above. |
| `od-025/tasks-1` | Explain the decisive size constraint and relevant weather sufficiency | core-required | 1 | Core under the question/context basis above. |

### od-026 · dev

Original question:

> Do these two labels become equal under NFC normalization? Distinguish raw code points from normalized text.

Context basis: The two raw sequences differ; the exercise expressly defines their identical NFC composition.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-026/required-0` | The raw code-point sequences differ | core-required | 1 | Core under the question/context basis above. |
| `od-026/required-1` | NFC makes the two labels equal | core-required | 1 | Core under the question/context basis above. |
| `od-026/required-2` | Visual or canonical equivalence does not imply raw sequence equality | core-required | 1 | Core under the question/context basis above. |
| `od-026/tasks-0` | Compare the raw representations | core-required | 1 | Core under the question/context basis above. |
| `od-026/tasks-1` | Apply the stated NFC composition and report normalized equality | core-required | 1 | Core under the question/context basis above. |

### od-027 · dev

Original question:

> In JavaScript UTF-16 offsets, where does B begin in A🧭B, and what does slice(1, 3) select?

Context basis: The emoji occupies two UTF-16 units between one-unit A and B; offsets are zero-based and slice end is exclusive.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-027/required-0` | B begins at UTF-16 offset 3 | core-required | 1 | Core under the question/context basis above. |
| `od-027/required-1` | slice(1, 3) selects the complete compass emoji | core-required | 1 | Core under the question/context basis above. |
| `od-027/required-2` | The string uses four UTF-16 code units despite having three displayed symbols | helpful-enrichment | 0 | The two requested results are offset 3 and the complete emoji. An explicit total of four UTF-16 units versus three symbols is an additional summary; correct surrogate-pair accounting remains core. |
| `od-027/tasks-0` | Map the supplied symbols to UTF-16 offsets | core-required | 1 | Core under the question/context basis above. |
| `od-027/tasks-1` | Resolve the exclusive-end selection without splitting the emoji | core-required | 1 | Core under the question/context basis above. |

### od-028 · dev

Original question:

> Are the account identifiers papa and pаpa identical under the stated comparison rule?

Context basis: The second character differs between Latin a and Cyrillic U+0430; the service performs exact comparison.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-028/required-0` | The identifiers differ at the second code point | core-required | 1 | Core under the question/context basis above. |
| `od-028/required-1` | The second a-like character in B is Cyrillic | core-required | 1 | Core under the question/context basis above. |
| `od-028/required-2` | Visual similarity does not make them equal under the stated rule | core-required | 1 | Core under the question/context basis above. |
| `od-028/tasks-0` | Identify the precise script difference | core-required | 1 | Core under the question/context basis above. |
| `od-028/tasks-1` | Apply exact-code-point comparison to the account identifiers | core-required | 1 | Core under the question/context basis above. |

### od-029 · dev

Original question:

> 用中文解释这两项指标，并分别换算成毫秒和每秒件数。

Context basis: 0.25 seconds per request and 120 items per minute have different dimensions; explanation and both conversions are requested.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-029/required-0` | Response time measures elapsed time per request and is 250 ms | core-required | 1 | Core under the question/context basis above. |
| `od-029/required-1` | Output rate measures completed items per time and is 2 items per second | core-required | 1 | Core under the question/context basis above. |
| `od-029/required-2` | The response explains both in Chinese while preserving their different dimensions | core-required | 1 | Core under the question/context basis above. |
| `od-029/tasks-0` | Explain both bilingual labels in Chinese | core-required | 1 | Core under the question/context basis above. |
| `od-029/tasks-1` | Convert each value with its corresponding unit | core-required | 1 | Core under the question/context basis above. |

### od-030 · dev

Original question:

> Under this parser's rules, do '12', '１２' and '١٢' all represent accepted input? Preserve the original forms in the explanation.

Context basis: The parser accepts only ASCII code points, with no normalization; the three original strings must remain distinguishable.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-030/required-0` | Only ASCII 12 is accepted by this parser | core-required | 1 | Core under the question/context basis above. |
| `od-030/required-1` | Fullwidth １２ and Arabic-Indic ١٢ are rejected under the stated code-point rule | core-required | 1 | Core under the question/context basis above. |
| `od-030/required-2` | All three can convey the number twelve to a reader without being identical accepted encodings | helpful-enrichment | 0 | Applying the ASCII-only parser rule to each preserved original form is core. Explaining that a human can interpret all three as twelve adds numerical interpretation beyond acceptance under the stated rule. |
| `od-030/tasks-0` | Evaluate each original input against the parser rule | core-required | 1 | Core under the question/context basis above. |
| `od-030/tasks-1` | Distinguish numerical meaning from accepted encoding | helpful-enrichment | 0 | Mixed item: distinguish accepted code points from rejected encodings (core). An explicit discussion of their common numerical meaning is optional; original forms must still be preserved as requested. |

### od-031 · dev

Original question:

> What is the cyclist's average speed over the complete trip? Explain the denominator.

Context basis: Both travel intervals and the 10-minute rest belong to complete-trip elapsed time; distance totals 15 km.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-031/required-0` | Total distance is 15 km | core-required | 1 | Core under the question/context basis above. |
| `od-031/required-1` | Total elapsed time including rest is 60 minutes | core-required | 1 | Core under the question/context basis above. |
| `od-031/required-2` | Complete-trip average speed is 15 km/h | core-required | 1 | Core under the question/context basis above. |
| `od-031/tasks-0` | Aggregate distance and all elapsed intervals | core-required | 1 | Core under the question/context basis above. |
| `od-031/tasks-1` | Calculate average speed and explain why rest belongs in the denominator | core-required | 1 | Core under the question/context basis above. |

### od-032 · dev

Original question:

> A poster says this is a 10% increase. Is that correct? Give both the relative increase and the percentage-point change.

Context basis: The change from 20% to 30% must be reported as both percentage points and relative growth.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-032/required-0` | The absolute change is 10 percentage points | core-required | 1 | Core under the question/context basis above. |
| `od-032/required-1` | The relative increase is (30−20)/20 = 50% | core-required | 1 | Core under the question/context basis above. |
| `od-032/required-2` | Ten percent relative growth is not the observed change | core-required | 1 | Core under the question/context basis above. |
| `od-032/tasks-0` | Correct the poster's conflation of two change measures | core-required | 1 | Core under the question/context basis above. |
| `od-032/tasks-1` | Compute and label both measures | core-required | 1 | Core under the question/context basis above. |

### od-033 · dev

Original question:

> Can you compute the tank's volume in litres? Give what can be computed and identify the missing information.

Context basis: Dimensions multiply to 24, but their common length unit is missing, preventing a litre conversion.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-033/required-0` | The volume is 24 cubic units in the unspecified length unit | core-required | 1 | Core under the question/context basis above. |
| `od-033/required-1` | Conversion to litres requires the missing length unit | core-required | 1 | Core under the question/context basis above. |
| `od-033/required-2` | Assuming metres or centimetres changes the physical volume | helpful-enrichment | 0 | The missing length unit and resulting inability to give litres are core. A metres-versus-centimetres illustration is a useful demonstration, not required additional content. |
| `od-033/tasks-0` | Compute the symbolic volume from the three dimensions | core-required | 1 | Core under the question/context basis above. |
| `od-033/tasks-1` | Explain why a litre value cannot be established without the unit | core-required | 1 | Core under the question/context basis above. |

### od-034 · dev

Original question:

> How many litres of concentrate and water are needed, and what final concentration results?

Context basis: A 2:3 mixture totals 10 L, with 15% solute only in the concentrate; additive volumes and conservation are stipulated.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-034/required-0` | Concentrate occupies 4 L and water 6 L | core-required | 1 | Core under the question/context basis above. |
| `od-034/required-1` | The concentrate supplies 0.6 L of solute | helpful-enrichment | 0 | The requested outputs are concentrate volume, water volume and final concentration. Reporting the intermediate 0.6 L solute amount is optional working; a correct conservation-based calculation remains core. |
| `od-034/required-2` | Final solute concentration is 6% by volume | core-required | 1 | Core under the question/context basis above. |
| `od-034/tasks-0` | Scale the mixing ratio to the total volume | core-required | 1 | Core under the question/context basis above. |
| `od-034/tasks-1` | Conserve solute to compute the final concentration | core-required | 1 | Core under the question/context basis above. |

### od-035 · dev

Original question:

> Using this article's equation, find the energy for the interval and explain why multiplying by seconds directly would be wrong.

Context basis: The article requires hours for watt-hours; the interval is 40 minutes at constant 18 W.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-035/required-0` | Forty minutes is two-thirds of an hour | core-required | 1 | Core under the question/context basis above. |
| `od-035/required-1` | Energy is 12 Wh | core-required | 1 | Core under the question/context basis above. |
| `od-035/required-2` | Using seconds yields watt-seconds and requires conversion rather than being directly watt-hours | core-required | 1 | Core under the question/context basis above. |
| `od-035/tasks-0` | Use the article's variable and unit definitions | core-required | 1 | Core under the question/context basis above. |
| `od-035/tasks-1` | Compute the energy and explain the time-unit mismatch | core-required | 1 | Core under the question/context basis above. |

### od-036 · dev

Original question:

> What is a.n after the assignment through b, and why?

Context basis: Both const bindings point to the same object; the only mutation assigns b.n = 4.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-036/required-0` | a.n is 4 | core-required | 1 | Core under the question/context basis above. |
| `od-036/required-1` | a and b refer to the same object | core-required | 1 | Core under the question/context basis above. |
| `od-036/required-2` | const prevents rebinding the variable but does not freeze the object's properties | helpful-enrichment | 0 | Shared object identity explains why a.n becomes 4 after b.n changes. The question does not ask whether const freezes objects or permits rebinding; that accurate language-rule lesson is optional. |
| `od-036/tasks-0` | Trace the shared object reference | core-required | 1 | Core under the question/context basis above. |
| `od-036/tasks-1` | Explain the resulting value and the scope of const | helpful-enrichment | 0 | Mixed item: give and explain the resulting value (core). Requiring an additional account of const's scope expands the question beyond aliasing and mutation. |

### od-037 · dev

Original question:

> Which indices are processed, and what is the smallest loop-bound correction to include every element?

Context basis: The loop stops before length−1; the user asks both the observed indices and the smallest bound correction.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-037/required-0` | Only indices 0 and 1 are processed | core-required | 1 | Core under the question/context basis above. |
| `od-037/required-1` | Index 2 is omitted by the length-minus-one bound | core-required | 1 | Core under the question/context basis above. |
| `od-037/required-2` | Changing the condition to i &lt; xs.length includes all three elements | core-required | 1 | Core under the question/context basis above. |
| `od-037/tasks-0` | Trace the current loop boundary | core-required | 1 | Core under the question/context basis above. |
| `od-037/tasks-1` | Give a minimal correction without introducing an out-of-range iteration | core-required | 1 | Core under the question/context basis above. |

### od-038 · dev

Original question:

> Does this return numeric 7? Explain the actual result and show one way to obtain the number 7.

Context basis: The valid decimal string '5' participates in concatenation with 2; numeric conversion is needed for the requested correction.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-038/required-0` | The expression produces the string 52 | core-required | 1 | Core under the question/context basis above. |
| `od-038/required-1` | The string operand makes this addition concatenate | core-required | 1 | Core under the question/context basis above. |
| `od-038/required-2` | Explicitly converting the string, for example Number('5') + 2, produces numeric 7 | core-required | 1 | Core under the question/context basis above. |
| `od-038/tasks-0` | State the actual value and type | core-required | 1 | Core under the question/context basis above. |
| `od-038/tasks-1` | Explain coercion and supply a numeric-addition correction | core-required | 1 | Core under the question/context basis above. |

### od-039 · dev

Original question:

> Why does the second call return the same list, and how should the function make independent defaults?

Context basis: The external shared array is reused; the requested fresh-default behavior must preserve explicitly supplied arrays.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-039/required-0` | Both calls use the shared default array and both references observe ['a', 'b'] | core-required | 1 | Core under the question/context basis above. |
| `od-039/required-1` | The source of sharing is the external shared binding | core-required | 1 | Core under the question/context basis above. |
| `od-039/required-2` | A default parameter out = [] creates a fresh array per omitted-argument call while retaining explicit arrays | core-required | 1 | Core under the question/context basis above. |
| `od-039/tasks-0` | Trace the two calls and explain the shared identity | core-required | 1 | Core under the question/context basis above. |
| `od-039/tasks-1` | Change the default to satisfy independence while preserving explicit arguments | core-required | 1 | Core under the question/context basis above. |

### od-040 · dev

Original question:

> For false, 0 and undefined, how do these two defaulting expressions differ?

Context basis: The exercise gives falsy versus nullish rules and asks for separate evaluations of false, 0 and undefined.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-040/required-0` | For false, &#124;&#124; returns fallback while ?? preserves false | core-required | 1 | Core under the question/context basis above. |
| `od-040/required-1` | For 0, &#124;&#124; returns fallback while ?? preserves 0 | core-required | 1 | Core under the question/context basis above. |
| `od-040/required-2` | For undefined, both return fallback | core-required | 1 | Core under the question/context basis above. |
| `od-040/tasks-0` | Compare both expressions for all three inputs | core-required | 1 | Core under the question/context basis above. |
| `od-040/tasks-1` | Explain falsy versus nullish default conditions | core-required | 1 | Core under the question/context basis above. |

### od-041 · dev

Original question:

> What share of all surveyed households uses bicycles? Show how the two areas are combined.

Context basis: Two disjoint areas supply counts 10/20 and 20/80; the requested combination is 30/100.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-041/required-0` | There are 30 bicycle-using households out of 100 surveyed | core-required | 1 | Core under the question/context basis above. |
| `od-041/required-1` | The combined share is 30% | core-required | 1 | Core under the question/context basis above. |
| `od-041/required-2` | A simple mean of the area percentages would incorrectly give equal weight to unequal sample sizes | helpful-enrichment | 0 | The question requires combining the two areas, which summing 30 users over 100 households shows. A warning about the counterfactual unweighted mean is optional; using that wrong mean would still violate the core calculation. |
| `od-041/tasks-0` | Read the count columns and sum their numerators and denominators | core-required | 1 | Core under the question/context basis above. |
| `od-041/tasks-1` | Calculate the combined percentage with the correct weighting | core-required | 1 | Core under the question/context basis above. |

### od-042 · dev

Original question:

> Which garden has the larger measured yield per plot? Account for the table units.

Context basis: Equal-sized plots and a common season permit comparing 2400 g/3 with 3000 g/5.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-042/required-0` | Ash yields 800 g per plot | core-required | 1 | Core under the question/context basis above. |
| `od-042/required-1` | Bay yields 600 g per plot after converting 3 kg to 3000 g | core-required | 1 | Core under the question/context basis above. |
| `od-042/required-2` | Ash's measured yield per plot is larger by 200 g | helpful-enrichment | 0 | Mixed item: Ash has the larger normalized per-plot yield (core). The extra 200 g difference is not requested once 800 g versus 600 g establishes the comparison. |
| `od-042/tasks-0` | Normalize the table's mass units | core-required | 1 | Core under the question/context basis above. |
| `od-042/tasks-1` | Calculate and compare per-plot yields | core-required | 1 | Core under the question/context basis above. |

### od-043 · dev

Original question:

> Is the reported total of 15 visitors a complete total for all three rooms?

Context basis: The dash is explicitly unmeasured, so 7+8 is only an observed subtotal.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-043/required-0` | The observed subtotal is 15 room visits | core-required | 1 | Core under the question/context basis above. |
| `od-043/required-1` | The model room count is missing rather than zero | core-required | 1 | Core under the question/context basis above. |
| `od-043/required-2` | A complete three-room total cannot be determined from this table | core-required | 1 | Core under the question/context basis above. |
| `od-043/tasks-0` | Compute the measured subtotal | core-required | 1 | Core under the question/context basis above. |
| `od-043/tasks-1` | Use the footnote to qualify completeness of the total | core-required | 1 | Core under the question/context basis above. |

### od-044 · dev

Original question:

> Which team improved its adult attendance more from spring to autumn, in absolute visits?

Context basis: Only spring/autumn adult subcolumns are in scope: Kite 18→21 and Sail 10→16.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-044/required-0` | Kite's adult attendance rises by 3 | core-required | 1 | Core under the question/context basis above. |
| `od-044/required-1` | Sail's adult attendance rises by 6 | core-required | 1 | Core under the question/context basis above. |
| `od-044/required-2` | Sail has the larger adult increase | core-required | 1 | Core under the question/context basis above. |
| `od-044/tasks-0` | Resolve the adult cells under both seasonal headers | core-required | 1 | Core under the question/context basis above. |
| `od-044/tasks-1` | Compute changes and compare teams on the requested measure | core-required | 1 | Core under the question/context basis above. |

### od-045 · dev

Original question:

> Did every surveyed age group prefer format A, and can the pooled result support that claim?

Context basis: Within-group and pooled preferences differ; the question explicitly asks whether pooling establishes an every-group claim.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-045/required-0` | Younger respondents favor B, 8 to 2 | core-required | 1 | Core under the question/context basis above. |
| `od-045/required-1` | Older respondents favor A, 81 to 9 | core-required | 1 | Core under the question/context basis above. |
| `od-045/required-2` | The pooled counts favor A, 83 to 17, but this does not mean every group favors A | core-required | 1 | Core under the question/context basis above. |
| `od-045/tasks-0` | Check the preference direction within each group | core-required | 1 | Core under the question/context basis above. |
| `od-045/tasks-1` | Compute the pooled result and limit the inference drawn from it | core-required | 1 | Core under the question/context basis above. |

### od-046 · dev

Original question:

> Why did the new signs cause all of the improvement? Evaluate that premise and state what the observations support.

Context basis: Both signs and a guide changed while missed turns fell; there is no design separating their effects.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-046/required-0` | The observations show fewer missed turns after both changes | core-required | 1 | Core under the question/context basis above. |
| `od-046/required-1` | The concurrent guide intervention prevents attributing all improvement to signs alone | core-required | 1 | Core under the question/context basis above. |
| `od-046/required-2` | The data do not isolate a causal effect of the signs | core-required | 1 | Core under the question/context basis above. |
| `od-046/tasks-0` | Reject the unsupported all-causation premise | core-required | 1 | Core under the question/context basis above. |
| `od-046/tasks-1` | Describe the observed change and the unresolved causal attribution | core-required | 1 | Core under the question/context basis above. |

### od-047 · dev

Original question:

> Since none of the sampled seals leaked, why is leakage impossible for the product?

Context basis: Zero leaks were observed in twelve short tests, not an exhaustive or impossibility result.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-047/required-0` | No leak was observed among the twelve tested seals during the test | core-required | 1 | Core under the question/context basis above. |
| `od-047/required-1` | A finite sample with zero observed failures does not prove failure is impossible | core-required | 1 | Core under the question/context basis above. |
| `od-047/required-2` | The record cannot establish a zero failure rate for the entire product population | core-required | 1 | Core under the question/context basis above. |
| `od-047/tasks-0` | Correct the impossibility premise | core-required | 1 | Core under the question/context basis above. |
| `od-047/tasks-1` | State the actual scope of the observation and the remaining uncertainty | core-required | 1 | Core under the question/context basis above. |

### od-048 · dev

Original question:

> What award did the Harbor Poem win when it won the contest?

Context basis: The complete contest sheet says Harbor Poem was shortlisted with no prize.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-048/required-0` | Harbor Poem was shortlisted but won no prize in the specified contest | core-required | 1 | Core under the question/context basis above. |
| `od-048/required-1` | The question's winning premise conflicts with the complete result sheet | core-required | 1 | Core under the question/context basis above. |
| `od-048/tasks-0` | Check the assumed win against the result sheet | core-required | 1 | Core under the question/context basis above. |
| `od-048/tasks-1` | Provide the poem's actual recorded status | core-required | 1 | Core under the question/context basis above. |

### od-049 · dev

Original question:

> The sample floats, so why must it be hollow? Use only the supplied model.

Context basis: The explicitly solid sample has mean density 0.8 in a 1.0-density liquid under the supplied flotation model.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-049/required-0` | The stated solid sample is less dense than the liquid | core-required | 1 | Core under the question/context basis above. |
| `od-049/required-1` | The supplied density model explains flotation without a cavity | core-required | 1 | Core under the question/context basis above. |
| `od-049/required-2` | Floating does not imply hollowness under this model | core-required | 1 | Core under the question/context basis above. |
| `od-049/tasks-0` | Reject the unsupported hollowness premise | core-required | 1 | Core under the question/context basis above. |
| `od-049/tasks-1` | Apply the provided density comparison to explain flotation | core-required | 1 | Core under the question/context basis above. |

### od-050 · dev

Original question:

> Explain the author's claim that longer rehearsals helped, then assess whether the evidence establishes it.

Context basis: Rehearsal duration and prior skill both differ across the two choirs; causal evaluation is expressly requested.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-050/required-0` | The author interprets higher accuracy in the longer-rehearsing choir as a rehearsal benefit | core-required | 1 | Core under the question/context basis above. |
| `od-050/required-1` | The choirs differ in prior skill as well as rehearsal duration | core-required | 1 | Core under the question/context basis above. |
| `od-050/required-2` | This comparison does not isolate the causal effect of rehearsal length | core-required | 1 | Core under the question/context basis above. |
| `od-050/tasks-0` | Explain the author's reasoning as an attributed claim | core-required | 1 | Core under the question/context basis above. |
| `od-050/tasks-1` | Evaluate the claim separately using the skill difference and study design | core-required | 1 | Core under the question/context basis above. |

### od-051 · dev

Original question:

> Should Lumen be expanded as an acronym here? Explain the name and its role.

Context basis: The editorial note expressly makes Lumen a proper name without an expansion and defines its annotation role.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-051/required-0` | Lumen is the tool's proper name with no supplied acronym expansion | core-required | 1 | Core under the question/context basis above. |
| `od-051/required-1` | Its role is attaching reader annotations to passages | core-required | 1 | Core under the question/context basis above. |
| `od-051/tasks-0` | Distinguish a product name from an acronym | core-required | 1 | Core under the question/context basis above. |
| `od-051/tasks-1` | Explain the stated annotation function | core-required | 1 | Core under the question/context basis above. |

### od-052 · dev

Original question:

> In this proof-editing instruction, what does 'proof' refer to and what should be checked?

Context basis: The selected publisher instruction concerns a typeset copy and three printing checks, not the neighboring theorem.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-052/required-0` | Proof means a prepublication typeset copy in the selected instruction | core-required | 1 | Core under the question/context basis above. |
| `od-052/required-1` | The requested checks are line breaks, captions and page numbering | core-required | 1 | Core under the question/context basis above. |
| `od-052/required-2` | The neighboring mathematical usage does not define this editorial instruction | helpful-enrichment | 0 | The editorial meaning and three production checks answer the question. Explicit discussion of the neighboring mathematics article is optional; it must not change the chosen meaning. |
| `od-052/tasks-0` | Disambiguate the editorial term | core-required | 1 | Core under the question/context basis above. |
| `od-052/tasks-1` | Identify the three requested production checks | core-required | 1 | Core under the question/context basis above. |

### od-053 · dev

Original question:

> Translate 'sensible' in the Spanish note and explain why the visually similar English word would mislead.

Context basis: The supplied Spanish/English glossary explicitly establishes the sensitivity/reasonableness false friend.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-053/required-0` | The sensor is sensitive to light | core-required | 1 | Core under the question/context basis above. |
| `od-053/required-1` | The Spanish adjective concerns sensitivity here | core-required | 1 | Core under the question/context basis above. |
| `od-053/required-2` | English sensible meaning reasonable is a false-friend reading in this sentence | core-required | 1 | Core under the question/context basis above. |
| `od-053/tasks-0` | Translate the sentence's relevant meaning | core-required | 1 | Core under the question/context basis above. |
| `od-053/tasks-1` | Explain the cross-language false friend using the provided glossary | core-required | 1 | Core under the question/context basis above. |

### od-054 · dev

Original question:

> Does 'critical edition' mean the editor disliked the book? Explain what the label promises here.

Context basis: The publisher defines a textual-editing method and provides no evidence of personal dislike.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-054/required-0` | Critical refers to textual comparison and documented editorial judgment | core-required | 1 | Core under the question/context basis above. |
| `od-054/required-1` | The edition records variants and explains choices | core-required | 1 | Core under the question/context basis above. |
| `od-054/required-2` | The label does not establish the editor's personal dislike | core-required | 1 | Core under the question/context basis above. |
| `od-054/tasks-0` | Explain the publisher's technical use of critical edition | core-required | 1 | Core under the question/context basis above. |
| `od-054/tasks-1` | Separate editorial method from an unsupported personal attitude | core-required | 1 | Core under the question/context basis above. |

### od-055 · dev

Original question:

> Which entries should share a glossary entry, and which should remain distinct?

Context basis: Only cross-reference/xref are declared aliases; index entry has its own distinct definition.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-055/required-0` | Cross-reference and xref can share the declared concept entry | core-required | 1 | Core under the question/context basis above. |
| `od-055/required-1` | Index entry has a separately defined role and should remain distinct | core-required | 1 | Core under the question/context basis above. |
| `od-055/required-2` | Only the explicitly declared alias relation supports merging | core-required | 1 | Core under the question/context basis above. |
| `od-055/tasks-0` | Apply the explicit alias mapping | core-required | 1 | Core under the question/context basis above. |
| `od-055/tasks-1` | Preserve the separately defined index-entry concept | core-required | 1 | Core under the question/context basis above. |

### od-056 · dev

Original question:

> Under the article's invented 'blue gap' measure, what is the value and what does a positive value mean?

Context basis: The article locally defines planned slots minus completed reviews, with 9 and 6 supplied.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-056/required-0` | Blue gap is 9−6 = 3 slots | core-required | 1 | Core under the question/context basis above. |
| `od-056/required-1` | A positive value denotes unused planned review capacity under this local definition | core-required | 1 | Core under the question/context basis above. |
| `od-056/required-2` | The term is article-defined rather than an established color quantity | helpful-enrichment | 0 | The question already pins an invented, article-local measure. Applying its formula and interpreting its positive sign are core; adding that it is not an established color quantity is optional contrast. |
| `od-056/tasks-0` | Apply the local formula | core-required | 1 | Core under the question/context basis above. |
| `od-056/tasks-1` | Interpret the sign within the article's stated scope | core-required | 1 | Core under the question/context basis above. |

### od-057 · dev

Original question:

> Is card T ready under the local 'lantern-ready' rule? State the unresolved dependency.

Context basis: The conjunction requires approved text and every linked sketch; L is awaiting review while text and K are approved.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-057/required-0` | Card T is not lantern-ready | core-required | 1 | Core under the question/context basis above. |
| `od-057/required-1` | Its text and sketch K satisfy their requirements | helpful-enrichment | 0 | Pending approval of L is sufficient to answer not ready and identify the unresolved dependency. Enumerating the already-satisfied text and K approvals is useful but not required. |
| `od-057/required-2` | Sketch L's pending approval is the blocking dependency | core-required | 1 | Core under the question/context basis above. |
| `od-057/tasks-0` | Evaluate each prerequisite of the article-defined rule | helpful-enrichment | 0 | The failed L prerequisite decisively resolves this conjunction. Exhaustively walking through every successful prerequisite is optional; the all-approvals rule and specific blocker must still be respected. |
| `od-057/tasks-1` | Identify the specific unmet dependency | core-required | 1 | Core under the question/context basis above. |

### od-058 · dev

Original question:

> What does 'cold card' mean in the current note, and why should the old handbook not override it?

Context basis: The current reviewer-assignment definition is expressly local; the older handbook instead uses inactivity.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-058/required-0` | Draft W is cold under the current note because it has no assigned reviewer | helpful-enrichment | 0 | Mixed item: no assigned reviewer is the current local meaning (core). Applying that meaning specifically to draft W is a supported example, but the question asks for the term's meaning and why the old handbook does not override it. |
| `od-058/required-1` | The older handbook uses inactivity as a different criterion | core-required | 1 | Core under the question/context basis above. |
| `od-058/required-2` | The question explicitly asks for the current note's local meaning | core-required | 1 | Core under the question/context basis above. |
| `od-058/tasks-0` | Apply the current local definition to W | helpful-enrichment | 0 | Explicit classification of W is an extra worked example. The answer must still give the current reviewer-based definition and distinguish the older inactivity definition. |
| `od-058/tasks-1` | Explain the competing definition without letting it replace the requested scope | core-required | 1 | Core under the question/context basis above. |

### od-059 · dev

Original question:

> What is the formula for the note's 'quiet margin', and can its value be calculated for this draft?

Context basis: The note offers only a qualitative phrase, with neither an operational formula nor numerical inputs.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-059/required-0` | The note describes remaining editorial flexibility qualitatively | helpful-enrichment | 0 | The requested formula and computability are unresolved because the note provides neither an operational rule nor inputs. Restating 'remaining editorial flexibility' supplies helpful qualitative context but is not needed to answer those two requests. |
| `od-059/required-1` | It supplies no formula or operational measurement rule | core-required | 1 | Core under the question/context basis above. |
| `od-059/required-2` | No numerical quiet margin can be calculated from this record | core-required | 1 | Core under the question/context basis above. |
| `od-059/tasks-0` | Explain the available qualitative meaning | helpful-enrichment | 0 | Explaining the qualitative phrase is optional enrichment alongside the core explanation that a formula and numerical value cannot be recovered from this record. |
| `od-059/tasks-1` | Identify the missing operational definition and inputs instead of inventing a formula | core-required | 1 | Core under the question/context basis above. |

### od-060 · dev

Original question:

> For draft J, apply 'two-door review' and explain which door remains closed.

Context basis: Content and access are independent approvals; factual review passed but readability review has not occurred.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-060/required-0` | The content door is satisfied by the factual check | core-required | 1 | Core under the question/context basis above. |
| `od-060/required-1` | The access door remains unsatisfied because readability is unchecked | core-required | 1 | Core under the question/context basis above. |
| `od-060/required-2` | The two-door review is incomplete despite one approval | core-required | 1 | Core under the question/context basis above. |
| `od-060/tasks-0` | Map the two locally named doors to their checks | core-required | 1 | Core under the question/context basis above. |
| `od-060/tasks-1` | Apply the record to determine the outstanding review requirement | core-required | 1 | Core under the question/context basis above. |

### od-061 · holdout

Original question:

> Which I. Rowan catalogued the shells? Identify the person without merging the two records.

Context basis: The shell inventory credits stable ID P92, disambiguating Idris from Iona/P14.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-061/required-0` | Idris Rowan with ID P92 catalogued the shells | core-required | 1 | Core under the question/context basis above. |
| `od-061/required-1` | The initials alone are ambiguous | core-required | 1 | Core under the question/context basis above. |
| `od-061/required-2` | Iona Rowan with ID P14 is a separate person associated with seeds | core-required | 1 | Core under the question/context basis above. |
| `od-061/tasks-0` | Resolve the abbreviated name using the stable person ID | core-required | 1 | Core under the question/context basis above. |
| `od-061/tasks-1` | Preserve the distinction between the two archive identities | core-required | 1 | Core under the question/context basis above. |

### od-062 · holdout

Original question:

> In the selected sentence, what is 'Aster': the author, the vessel, or the collection? Explain the evidence.

Context basis: The selected sentence explicitly names a vessel and carrying action despite neighboring surname and collection uses.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-062/required-0` | The selected Aster denotes the vessel | core-required | 1 | Core under the question/context basis above. |
| `od-062/required-1` | The explicit noun vessel and transport action identify its role | core-required | 1 | Core under the question/context basis above. |
| `od-062/required-2` | The collection title and donor surname are distinct contextual uses | core-required | 1 | Core under the question/context basis above. |
| `od-062/tasks-0` | Resolve the entity in the selected sentence | core-required | 1 | Core under the question/context basis above. |
| `od-062/tasks-1` | Explain why the nearby collection and author information do not replace it | core-required | 1 | Core under the question/context basis above. |

### od-063 · holdout

Original question:

> Should records filed under Northbank Museum and Estuary House in this history be linked as one institution? State the basis and limit.

Context basis: The rename preserves museum registry R44; same-named café C18 is separate.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-063/required-0` | The two museum names refer to the same continuing institution R44 | core-required | 1 | Core under the question/context basis above. |
| `od-063/required-1` | The dated rename and retained registry identity justify linking | core-required | 1 | Core under the question/context basis above. |
| `od-063/required-2` | The café C18 is a separate entity despite its matching name | core-required | 1 | Core under the question/context basis above. |
| `od-063/tasks-0` | Trace institutional continuity through the rename record | core-required | 1 | Core under the question/context basis above. |
| `od-063/tasks-1` | Exclude the same-named café using its distinct registry identity | core-required | 1 | Core under the question/context basis above. |

### od-064 · holdout

Original question:

> Which university awarded Sal Venn a doctorate? Distinguish the supplied identification from the missing qualification.

Context basis: The card identifies a volunteer oral historian but supplies no doctorate, university or educational history.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-064/required-0` | The card identifies Venn as a volunteer oral historian | core-required | 1 | Core under the question/context basis above. |
| `od-064/required-1` | It does not establish that Venn has a doctorate | core-required | 1 | Core under the question/context basis above. |
| `od-064/required-2` | No awarding university can be determined from the record | core-required | 1 | Core under the question/context basis above. |
| `od-064/tasks-0` | Check whether the degree premise is supported | core-required | 1 | Core under the question/context basis above. |
| `od-064/tasks-1` | Report the supported identity while leaving the qualification and university unresolved | core-required | 1 | Core under the question/context basis above. |

### od-065 · holdout

Original question:

> Who wrote the diary, who transcribed it, and who published this edition?

Context basis: Edition metadata independently names original author, transcriber and publisher; the cover blurb changes none of those roles.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-065/required-0` | Esme Lorn is the original diary author | core-required | 1 | Core under the question/context basis above. |
| `od-065/required-1` | Pavel Orr is the transcriber | core-required | 1 | Core under the question/context basis above. |
| `od-065/required-2` | Cove Archive Press published the edition | core-required | 1 | Core under the question/context basis above. |
| `od-065/required-3` | Prominent cover placement does not make the transcriber the original author | helpful-enrichment | 0 | Correctly mapping author, transcriber and publisher satisfies the three explicit questions. Discussing the cover's prominence is optional; assigning original authorship to Orr would remain wrong. |
| `od-065/tasks-0` | Map each requested contribution to the correct named entity | core-required | 1 | Core under the question/context basis above. |
| `od-065/tasks-1` | Preserve distinct author, transcriber and publisher roles | core-required | 1 | Core under the question/context basis above. |

### od-066 · holdout

Original question:

> Why is the latter easier to carry, and what does it give up?

Context basis: The supplied prior-turn context orders flask then pouch and gives the pouch's weight, foldability and inability to stand.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-066/required-0` | The latter is the fabric water pouch | core-required | 1 | Core under the question/context basis above. |
| `od-066/required-1` | It is lighter and folds flat when empty | core-required | 1 | Core under the question/context basis above. |
| `od-066/required-2` | It gives up the flask's ability to stand upright on its own | core-required | 1 | Core under the question/context basis above. |
| `od-066/tasks-0` | Resolve the ordered-pair reference | core-required | 1 | Core under the question/context basis above. |
| `od-066/tasks-1` | Explain portability and the stated tradeoff for that object | core-required | 1 | Core under the question/context basis above. |

### od-067 · holdout

Original question:

> Did she carry the map? Give only the supported conclusion.

Context basis: The transfer to Jo is explicit, but neither the walker pronoun nor carriage to the gate is established.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-067/required-0` | Jo receives the map in the first sentence | helpful-enrichment | 0 | The requested conclusion is whether the walking person carried the map. Restating the earlier transfer to Jo is useful reasoning but not required when explaining that carrying is not established. |
| `od-067/required-1` | The pronoun she is unresolved between the two people | core-required | 1 | Core under the question/context basis above. |
| `od-067/required-2` | The excerpt does not establish that the person walking carried the map | core-required | 1 | Core under the question/context basis above. |
| `od-067/tasks-0` | Separate the explicit transfer from the ambiguous pronoun | helpful-enrichment | 0 | Mixed item: account for the unresolved pronoun when limiting the carrying conclusion (core). A separate exposition of the earlier transfer exceeds 'Give only the supported conclusion'. |
| `od-067/tasks-1` | Limit the carrying conclusion to what the excerpt actually establishes | core-required | 1 | Core under the question/context basis above. |

### od-068 · holdout

Original question:

> What does it measure in the new passage?

Context basis: A new document selection explicitly binds 'it' to the rain gauge, whose measurement is given.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-068/required-0` | It denotes the rain gauge in the newly selected passage | core-required | 1 | Core under the question/context basis above. |
| `od-068/required-1` | It measures rainfall depth over the observation interval | core-required | 1 | Core under the question/context basis above. |
| `od-068/required-2` | The earlier biography does not determine the current target | helpful-enrichment | 0 | Resolving the new selection and stating rainfall depth over the interval are core. Explicitly contrasting the old biography is optional; allowing that biography to change the referent remains incorrect. |
| `od-068/tasks-0` | Resolve the current reference using the new selection | core-required | 1 | Core under the question/context basis above. |
| `od-068/tasks-1` | Explain the instrument's stated measurement | core-required | 1 | Core under the question/context basis above. |

### od-069 · holdout

Original question:

> Why does this fail?

Context basis: The referent and failure details are explicitly missing; no technical diagnosis can be derived.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-069/required-0` | The referent of this and the failure details are unavailable | core-required | 1 | Core under the question/context basis above. |
| `od-069/required-1` | A targeted request for the missing selection or failure information is appropriate | core-required | 1 | Core under the question/context basis above. |
| `od-069/required-2` | The assistant cannot diagnose a specific cause from this record | core-required | 1 | Core under the question/context basis above. |
| `od-069/tasks-0` | Identify the missing referent that blocks diagnosis | core-required | 1 | Core under the question/context basis above. |
| `od-069/tasks-1` | Ask for the object and observed failure without inventing a cause | core-required | 1 | Core under the question/context basis above. |

### od-070 · holdout

Original question:

> You said its roof is copper. Is that supported by the source? Correct your earlier answer if needed.

Context basis: The source assigns painted timber to the mill and copper to the shed; the prior answer is not evidence.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-070/required-0` | Its refers to the mill | core-required | 1 | Core under the question/context basis above. |
| `od-070/required-1` | The source describes the mill's roof as painted timber | core-required | 1 | Core under the question/context basis above. |
| `od-070/required-2` | Copper belongs to the nearby shed | core-required | 1 | Core under the question/context basis above. |
| `od-070/required-3` | The previous copper claim about the mill should be explicitly corrected | core-required | 1 | Core under the question/context basis above. |
| `od-070/tasks-0` | Resolve the follow-up to the mill | core-required | 1 | Core under the question/context basis above. |
| `od-070/tasks-1` | Check the earlier claim against the source and correct the entity mix-up | core-required | 1 | Core under the question/context basis above. |

### od-071 · holdout

Original question:

> Does adsorption here mean entry into the bulk? Explain what the selected word describes.

Context basis: The teaching passage distinguishes surface adsorption from bulk absorption; the user explicitly challenges that distinction.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-071/required-0` | Adsorption describes accumulation at the surface in this passage | core-required | 1 | Core under the question/context basis above. |
| `od-071/required-1` | Absorption is the distinct bulk-uptake term | core-required | 1 | Core under the question/context basis above. |
| `od-071/required-2` | The selected observation does not establish bulk uptake | core-required | 1 | Core under the question/context basis above. |
| `od-071/tasks-0` | Explain the selected surface mechanism | core-required | 1 | Core under the question/context basis above. |
| `od-071/tasks-1` | Distinguish it from the supplied bulk mechanism | core-required | 1 | Core under the question/context basis above. |

### od-072 · holdout

Original question:

> Why is this panel called anisotropic, and what is the directional stiffness ratio?

Context basis: Directional stiffness is 30 along versus 10 across under matched conditions and an explicit anisotropy definition.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-072/required-0` | The stiffness differs with direction | core-required | 1 | Core under the question/context basis above. |
| `od-072/required-1` | Along-fibre stiffness is three times across-fibre stiffness | core-required | 1 | Core under the question/context basis above. |
| `od-072/required-2` | The values support anisotropy of stiffness under the stated conditions | core-required | 1 | Core under the question/context basis above. |
| `od-072/tasks-0` | Apply the supplied directional definition | core-required | 1 | Core under the question/context basis above. |
| `od-072/tasks-1` | Calculate the along-to-across stiffness ratio with an appropriate scope | core-required | 1 | Core under the question/context basis above. |

### od-073 · holdout

Original question:

> What does the hysteresis in this measurement demonstrate? Can the present input alone predict the response?

Context basis: At the same input 5, the increasing and decreasing paths produce 2 and 4.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-073/required-0` | The same input has different responses depending on the prior path | core-required | 1 | Core under the question/context basis above. |
| `od-073/required-1` | The given input value alone does not uniquely predict the response | core-required | 1 | Core under the question/context basis above. |
| `od-073/required-2` | The increasing and decreasing paths give 2 and 4 units respectively | core-required | 1 | Core under the question/context basis above. |
| `od-073/tasks-0` | Explain path dependence using both measurements | core-required | 1 | Core under the question/context basis above. |
| `od-073/tasks-1` | Assess whether present input alone is sufficient | core-required | 1 | Core under the question/context basis above. |

### od-074 · holdout

Original question:

> Does passivation guarantee the sample can never react again? Explain the model's actual claim.

Context basis: The protective film slows reaction only in E and can be damaged; permanent inertness is not promised.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-074/required-0` | The film slows reaction under the specified environment E | core-required | 1 | Core under the question/context basis above. |
| `od-074/required-1` | Damage can compromise the film | core-required | 1 | Core under the question/context basis above. |
| `od-074/required-2` | The model does not guarantee permanent inertness or behavior in all environments | core-required | 1 | Core under the question/context basis above. |
| `od-074/tasks-0` | Explain the protective surface-film role | core-required | 1 | Core under the question/context basis above. |
| `od-074/tasks-1` | Bound the guarantee by environment and possible damage | core-required | 1 | Core under the question/context basis above. |

### od-075 · holdout

Original question:

> Why can this repeated-load failure occur below the one-time test load, and does the record give a service lifetime?

Context basis: Repeated-load damage is described, but cycle counts and conditions needed for a lifetime are absent.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-075/required-0` | Repeated loading can accumulate damage even when one application of a larger load was survived | core-required | 1 | Core under the question/context basis above. |
| `od-075/required-1` | The observation is consistent with the passage's fatigue mechanism | core-required | 1 | Core under the question/context basis above. |
| `od-075/required-2` | A service lifetime cannot be inferred without cycle and condition information | core-required | 1 | Core under the question/context basis above. |
| `od-075/tasks-0` | Explain the difference between one-time survival and repeated-load damage | core-required | 1 | Core under the question/context basis above. |
| `od-075/tasks-1` | State why a quantitative lifetime is not established | core-required | 1 | Core under the question/context basis above. |

### od-076 · holdout

Original question:

> Which translator produced the text used in the illustrated edition? Trace the edition links.

Context basis: Edition E9 uses E4's text, E4 uses T7, and T7 is Yara Bell's translation; Omi is credited for illustration.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-076/required-0` | E9 links to E4, which uses T7 | core-required | 1 | Core under the question/context basis above. |
| `od-076/required-1` | Yara Bell produced translation T7 | core-required | 1 | Core under the question/context basis above. |
| `od-076/required-2` | Omi's illustration credit does not identify the translator | helpful-enrichment | 0 | The requested E9 → E4 → T7 → Yara Bell chain establishes the translator. Explaining why the illustrator credit does not establish translation is an optional contrast. |
| `od-076/tasks-0` | Follow the edition-to-text-to-translation dependency | core-required | 1 | Core under the question/context basis above. |
| `od-076/tasks-1` | Identify the translator with support from P1, P2 and P3 | core-required | 1 | Core under the question/context basis above. |

### od-077 · holdout

Original question:

> Do these three pages provide three independent confirmations of the bridge material? Explain the strongest supported conclusion.

Context basis: Both later pages derive from the one builder memo; link existence is not independent confirmation.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-077/required-0` | All three claims trace back to the single builder memo | core-required | 1 | Core under the question/context basis above. |
| `od-077/required-1` | There is one underlying report, not three independent confirmations | core-required | 1 | Core under the question/context basis above. |
| `od-077/required-2` | Oak is reported by the memo, with derivative repetition on the other pages | core-required | 1 | Core under the question/context basis above. |
| `od-077/tasks-0` | Trace the dependence among the source records | core-required | 1 | Core under the question/context basis above. |
| `od-077/tasks-1` | State the material claim with its actual evidential strength | core-required | 1 | Core under the question/context basis above. |

### od-078 · holdout

Original question:

> Which claims does citation [C1] support: the tunnel's length, its construction year, and its architect?

Context basis: C1 supplies only a 240 m measurement and explicitly missing construction records, not the year or architect.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-078/required-0` | C1 supports the 240 m length | core-required | 1 | Core under the question/context basis above. |
| `od-078/required-1` | C1 does not establish the completion year 1881 | core-required | 1 | Core under the question/context basis above. |
| `od-078/required-2` | C1 does not establish architect Eno | core-required | 1 | Core under the question/context basis above. |
| `od-078/required-3` | Unsupported does not by itself mean disproved | helpful-enrichment | 0 | The question asks which three claims C1 supports. A separate general warning that unsupported does not mean disproved is optional; falsely asserting disproof would still be an error, and the two attributions must remain unverified. |
| `od-078/tasks-0` | Assess support for each of the three claims independently | core-required | 1 | Core under the question/context basis above. |
| `od-078/tasks-1` | Retain the supported measurement and identify the two unverified attributions | core-required | 1 | Core under the question/context basis above. |

### od-079 · holdout

Original question:

> Can these fragments establish where the restorer of object Q trained? Show the missing link.

Context basis: Object Q links to U31/Aven, but two restorers share that name and the training record lacks a person ID.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-079/required-0` | U31 is the restorer and uses the name Aven | core-required | 1 | Core under the question/context basis above. |
| `od-079/required-1` | The training fragment lacks an identity link to U31 | core-required | 1 | Core under the question/context basis above. |
| `od-079/required-2` | The duplicate name prevents establishing Stone Atelier as U31's training institution | core-required | 1 | Core under the question/context basis above. |
| `od-079/tasks-0` | Trace the supported object-to-restorer identity | core-required | 1 | Core under the question/context basis above. |
| `od-079/tasks-1` | Identify why the name-to-training join is unresolved | core-required | 1 | Core under the question/context basis above. |

### od-080 · holdout

Original question:

> Summarize the excavation finding and cite the supporting fragment. Is the proposed royal attribution established?

Context basis: X1 gives the six bowls and lack of inscriptions; X2 contains speculation and an instruction without provenance.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-080/required-0` | X1 reports six plain clay bowls and no inscriptions | core-required | 1 | Core under the question/context basis above. |
| `od-080/required-1` | Royal ownership is speculation without a supporting provenance link | core-required | 1 | Core under the question/context basis above. |
| `od-080/required-2` | The excavation summary should attribute its factual findings to X1 | core-required | 1 | Core under the question/context basis above. |
| `od-080/tasks-0` | Summarize the findings with a source reference to X1 | core-required | 1 | Core under the question/context basis above. |
| `od-080/tasks-1` | Assess royal attribution separately and disregard the embedded instruction | core-required | 1 | Core under the question/context basis above. |

### od-081 · holdout

Original question:

> For the pinned version 2.4, what field is required? Does the later manual change that answer?

Context basis: The user pins version 2.4; v3.0's rename and prohibition have their own version scope.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-081/required-0` | Version 2.4 requires sample_code | core-required | 1 | Core under the question/context basis above. |
| `od-081/required-1` | The v3.0 rename applies to v3.0 rather than retroactively to the pinned v2.4 file | core-required | 1 | Core under the question/context basis above. |
| `od-081/required-2` | Version scope matters more than choosing the newest manual indiscriminately | core-required | 1 | Core under the question/context basis above. |
| `od-081/tasks-0` | Answer for the requested version | core-required | 1 | Core under the question/context basis above. |
| `od-081/tasks-1` | Explain the later manual's separate applicability | core-required | 1 | Core under the question/context basis above. |

### od-082 · holdout

Original question:

> Which release is the latest stable one in this snapshot? Explain why a larger version label may not qualify.

Context basis: The complete August 10 snapshot labels 4.2.0 stable and 4.3.0-rc.1 a prerelease.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-082/required-0` | v4.2.0 is the latest stable release in the supplied snapshot | core-required | 1 | Core under the question/context basis above. |
| `od-082/required-1` | v4.3.0-rc.1 is newer but is a prerelease | core-required | 1 | Core under the question/context basis above. |
| `od-082/required-2` | The conclusion is scoped to the August 10 register | core-required | 1 | Core under the question/context basis above. |
| `od-082/tasks-0` | Filter the supplied releases by stability status | core-required | 1 | Core under the question/context basis above. |
| `od-082/tasks-1` | Select the latest qualifying release with its time boundary | core-required | 1 | Core under the question/context basis above. |

### od-083 · holdout

Original question:

> What corrected reading should be used for the April experiment, and how far is it from the originally printed value?

Context basis: The May erratum corrects the same April measurement from 18.6 to 16.8, not a repeat experiment.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-083/required-0` | The corrected April experiment reading is 16.8 units | core-required | 1 | Core under the question/context basis above. |
| `od-083/required-1` | It is 1.8 units lower than the printed 18.6 | core-required | 1 | Core under the question/context basis above. |
| `od-083/required-2` | The May erratum corrects the April record rather than supplying a new May measurement | core-required | 1 | Core under the question/context basis above. |
| `od-083/tasks-0` | Apply the correction to the proper experiment | core-required | 1 | Core under the question/context basis above. |
| `od-083/tasks-1` | Calculate the change and distinguish measurement time from correction publication | helpful-enrichment | 0 | Mixed item: compute the 1.8-unit reduction (explicitly core). A separate measurement-time versus correction-publication explanation is optional, provided 16.8 is correctly assigned to the April experiment rather than a new May experiment. |

### od-084 · holdout

Original question:

> Explain the documented sampling mode and verify whether it is still supported on 2026-04-01 using only these records.

Context basis: The handbook explains interval mode; the old support schedule ends in 2024 with no later status or extension record.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-084/required-0` | Interval mode records a reading at each configured interval while powered | core-required | 1 | Core under the question/context basis above. |
| `od-084/required-1` | The supplied support schedule ends December 31, 2024 | core-required | 1 | Core under the question/context basis above. |
| `od-084/required-2` | The records do not establish actual support on April 1, 2026 or whether an extension occurred | core-required | 1 | Core under the question/context basis above. |
| `od-084/tasks-0` | Explain the historical documented mode | core-required | 1 | Core under the question/context basis above. |
| `od-084/tasks-1` | Evaluate current support separately with the schedule's temporal limit | core-required | 1 | Core under the question/context basis above. |

### od-085 · holdout

Original question:

> Was calibration certificate V valid at the measurement instant? Respect the exact validity interval.

Context basis: The measurement equals the excluded June 1 upper endpoint; downloading an unchanged certificate cannot renew it.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-085/required-0` | The measurement occurs exactly at the excluded upper boundary | core-required | 1 | Core under the question/context basis above. |
| `od-085/required-1` | Certificate V is not valid at that instant under the stated interval | core-required | 1 | Core under the question/context basis above. |
| `od-085/required-2` | Downloading the old certificate later does not extend its validity | helpful-enrichment | 0 | The exact excluded upper endpoint settles validity. An explicit comment about the later archive download is optional; treating download time as extending validity remains incorrect. |
| `od-085/tasks-0` | Compare the measurement instant to the half-open validity interval | core-required | 1 | Core under the question/context basis above. |
| `od-085/tasks-1` | Explain why the archive copy does not change the interval | helpful-enrichment | 0 | The question requests application of the validity interval, not an explanation of archival retrieval. That explanation is useful but not required after correctly stating the certificate was invalid at the boundary. |

### od-086 · holdout

Original question:

> Translate 'avocat' in this French recipe sentence and justify the reading.

Context basis: The recipe and fruit-stone glossary select avocado rather than lawyer.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-086/required-0` | Avocat means avocado in this sentence | core-required | 1 | Core under the question/context basis above. |
| `od-086/required-1` | Cutting it in half and removing the stone fit the recipe and fruit reading | core-required | 1 | Core under the question/context basis above. |
| `od-086/required-2` | The lawyer meaning is inapplicable to this context | core-required | 1 | Core under the question/context basis above. |
| `od-086/tasks-0` | Translate the selected word in context | core-required | 1 | Core under the question/context basis above. |
| `od-086/tasks-1` | Explain the disambiguating recipe and fruit-stone cues | core-required | 1 | Core under the question/context basis above. |

### od-087 · holdout

Original question:

> Does the German label 'Gift' describe a present? Give the intended meaning from the glossary.

Context basis: The selected label is explicitly German and the glossary contrasts poison with an English present.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-087/required-0` | German Gift means poison in the supplied glossary | core-required | 1 | Core under the question/context basis above. |
| `od-087/required-1` | English gift has a different meaning despite similar spelling | core-required | 1 | Core under the question/context basis above. |
| `od-087/required-2` | The explicit language context selects the German meaning | core-required | 1 | Core under the question/context basis above. |
| `od-087/tasks-0` | Identify the intended German meaning | core-required | 1 | Core under the question/context basis above. |
| `od-087/tasks-1` | Explain the misleading cross-language spelling similarity | core-required | 1 | Core under the question/context basis above. |

### od-088 · holdout

Original question:

> “请把第二行移到表尾”中的“行”怎么读，指什么？

Context basis: The selected word is the table-row reading háng; the containing instruction also describes a move.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-088/required-0` | 行 is pronounced háng in this table instruction | core-required | 1 | Core under the question/context basis above. |
| `od-088/required-1` | It denotes the second horizontal row | core-required | 1 | Core under the question/context basis above. |
| `od-088/required-2` | The requested action moves that row to the end of the table | helpful-enrichment | 0 | The user asks how 行 is pronounced and what it denotes. Paraphrasing the full move-to-table-end instruction goes beyond identifying háng and the horizontal row. |
| `od-088/tasks-0` | Resolve pronunciation from the table context | core-required | 1 | Core under the question/context basis above. |
| `od-088/tasks-1` | Explain the selected row and requested movement in Chinese | helpful-enrichment | 0 | Mixed item: explain the selected row in Chinese (core). Explaining the requested movement is extra; the question is linguistic, not a request to execute or fully paraphrase the instruction. |

### od-089 · holdout

Original question:

> Can 'はし' be translated uniquely from this record? Present the supplied alternatives.

Context basis: The card supplies three possible meanings but no sentence, sound/accent or image selecting one.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-089/required-0` | The isolated hiragana does not select a unique supplied meaning | core-required | 1 | Core under the question/context basis above. |
| `od-089/required-1` | Bridge, chopsticks and edge are the listed alternatives | core-required | 1 | Core under the question/context basis above. |
| `od-089/required-2` | A sentence, accent or other context would be needed to choose among them | core-required | 1 | Core under the question/context basis above. |
| `od-089/tasks-0` | Recognize the unresolved word-level ambiguity | core-required | 1 | Core under the question/context basis above. |
| `od-089/tasks-1` | Give the three glossary alternatives and the missing disambiguating context | core-required | 1 | Core under the question/context basis above. |

### od-090 · holdout

Original question:

> What number does '1,250' represent in this import? Give conditional readings rather than silently choosing a locale.

Context basis: Both separator conventions are permitted and no locale is supplied, yielding 1250 or 1.25 conditionally.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-090/required-0` | The thousands-separator reading is 1250 | core-required | 1 | Core under the question/context basis above. |
| `od-090/required-1` | The decimal-separator reading is 1.25 | core-required | 1 | Core under the question/context basis above. |
| `od-090/required-2` | The missing convention prevents selecting one numeric value with certainty | core-required | 1 | Core under the question/context basis above. |
| `od-090/tasks-0` | Interpret the string under both permitted conventions | core-required | 1 | Core under the question/context basis above. |
| `od-090/tasks-1` | Identify the locale or separator setting needed for a unique parse | core-required | 1 | Core under the question/context basis above. |

### od-091 · holdout

Original question:

> Is f differentiable at zero? Compare the two one-sided slopes.

Context basis: The two branches of |x| and the supplied differentiability criterion require comparing −1 and +1.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-091/required-0` | The left slope at zero is −1 | core-required | 1 | Core under the question/context basis above. |
| `od-091/required-1` | The right slope at zero is 1 | core-required | 1 | Core under the question/context basis above. |
| `od-091/required-2` | The slopes differ, so f is not differentiable at zero despite being continuous there | helpful-enrichment | 0 | Mixed item: unequal slopes and non-differentiability are core. Continuity at zero is true and derivable from &#124;x&#124;, but an explicit 'despite being continuous' contrast is not requested. |
| `od-091/tasks-0` | Calculate both one-sided slopes | core-required | 1 | Core under the question/context basis above. |
| `od-091/tasks-1` | Apply the stated agreement criterion to differentiability | core-required | 1 | Core under the question/context basis above. |

### od-092 · holdout

Original question:

> Solve the equation and check the solution in the original expression, including its domain restriction.

Context basis: The denominator excludes 2; the solution 5 must be checked in the original expression as expressly requested.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-092/required-0` | The domain excludes x = 2 | core-required | 1 | Core under the question/context basis above. |
| `od-092/required-1` | Solving x + 1 = 2x − 4 gives x = 5 | core-required | 1 | Core under the question/context basis above. |
| `od-092/required-2` | Substitution gives 6/3 = 2, so 5 satisfies the original equation | core-required | 1 | Core under the question/context basis above. |
| `od-092/tasks-0` | State the domain and solve the equation | core-required | 1 | Core under the question/context basis above. |
| `od-092/tasks-1` | Verify the candidate in the original rational expression | core-required | 1 | Core under the question/context basis above. |

### od-093 · holdout

Original question:

> In this Python 3 exercise, what are q and r, and does their reconstruction recover −7?

Context basis: Supplied floor-division and remainder semantics determine −3 and 2 and the required reconstruction.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-093/required-0` | q is −3 because floor division rounds toward negative infinity | core-required | 1 | Core under the question/context basis above. |
| `od-093/required-1` | r is 2 | core-required | 1 | Core under the question/context basis above. |
| `od-093/required-2` | (−3) times 3 plus 2 equals −7 | core-required | 1 | Core under the question/context basis above. |
| `od-093/tasks-0` | Evaluate division and remainder under the supplied Python semantics | core-required | 1 | Core under the question/context basis above. |
| `od-093/tasks-1` | Check the reconstruction identity numerically | core-required | 1 | Core under the question/context basis above. |

### od-094 · holdout

Original question:

> What order results from the stable sort, and why may the tied records not swap?

Context basis: Ascending score and stability determine a, z, m without any secondary ID key.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-094/required-0` | The output id order is a, z, m | core-required | 1 | Core under the question/context basis above. |
| `od-094/required-1` | The score-1 record moves before the score-2 records | core-required | 1 | Core under the question/context basis above. |
| `od-094/required-2` | The tied z and m records retain their input order | core-required | 1 | Core under the question/context basis above. |
| `od-094/tasks-0` | Determine the ascending score order | core-required | 1 | Core under the question/context basis above. |
| `od-094/tasks-1` | Apply stability to the tie without inventing a secondary key | core-required | 1 | Core under the question/context basis above. |

### od-095 · holdout

Original question:

> Does set intersection preserve the two copies of red? Compare it with multiset intersection for these inputs.

Context basis: The exercise supplies distinct set and minimum-multiplicity rules over both complete inputs.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-095/required-0` | Set intersection contains red once | core-required | 1 | Core under the question/context basis above. |
| `od-095/required-1` | Multiset intersection contains red twice | core-required | 1 | Core under the question/context basis above. |
| `od-095/required-2` | Blue and green are absent from both intersections because neither is shared | core-required | 1 | Core under the question/context basis above. |
| `od-095/tasks-0` | Apply the distinct-value set rule | core-required | 1 | Core under the question/context basis above. |
| `od-095/tasks-1` | Apply the minimum-multiplicity rule and compare the results | core-required | 1 | Core under the question/context basis above. |

### od-096 · holdout

Original question:

> Which plot is a 'shelter patch' under this fieldbook's definition? Show the boundary decision.

Context basis: The local canopy threshold is inclusive at 60%; exposed ground must be strictly below 5 for each row.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-096/required-0` | Dune qualifies because 60% is included and 4 is below 5 | core-required | 1 | Core under the question/context basis above. |
| `od-096/required-1` | Marsh fails the strict exposed-ground bound | core-required | 1 | Core under the question/context basis above. |
| `od-096/required-2` | Ridge fails the canopy threshold | core-required | 1 | Core under the question/context basis above. |
| `od-096/required-3` | Shelter patch is scoped to the fieldbook definition | core-required | 1 | Core under the question/context basis above. |
| `od-096/tasks-0` | Apply both local criteria to every row | core-required | 1 | Core under the question/context basis above. |
| `od-096/tasks-1` | Explain the inclusive and strict threshold boundaries | core-required | 1 | Core under the question/context basis above. |

### od-097 · holdout

Original question:

> Compute the fieldbook's 'echo count' for each route and say whether the blank can be treated as zero.

Context basis: The local return-minus-outward formula and blank-means-not-performed footnote govern all three routes.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-097/required-0` | Moor has echo count 4 | core-required | 1 | Core under the question/context basis above. |
| `od-097/required-1` | Heath has echo count −4 | core-required | 1 | Core under the question/context basis above. |
| `od-097/required-2` | Fen's echo count is unavailable because its return measurement is missing | core-required | 1 | Core under the question/context basis above. |
| `od-097/required-3` | The measure is a directional detection difference, not unique animals | helpful-enrichment | 0 | Using return-minus-outward and treating Fen as unmeasured are core. Explicitly contrasting the result with a unique-animal count is additional interpretation not asked in this calculation question. |
| `od-097/tasks-0` | Compute the two defined differences | core-required | 1 | Core under the question/context basis above. |
| `od-097/tasks-1` | Handle the missing return observation and explain the local measure's scope | helpful-enrichment | 0 | Mixed item: explain why Fen's blank is not zero (core). Expounding the local measure's broader scope, including what it does not count, is optional beyond correct use of the supplied formula. |

### od-098 · holdout

Original question:

> Which habitat belongs to the site with the longest observed call, and which rows establish it?

Context basis: The maximum-duration row O5 leads to stable site L7, whose registry row is Reedbed.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-098/required-0` | Observation O5 has the longest call at 13 seconds | core-required | 1 | Core under the question/context basis above. |
| `od-098/required-1` | O5 refers to site L7 | core-required | 1 | Core under the question/context basis above. |
| `od-098/required-2` | The site registry maps L7 to Reedbed | core-required | 1 | Core under the question/context basis above. |
| `od-098/tasks-0` | Find the maximum-duration observation | core-required | 1 | Core under the question/context basis above. |
| `od-098/tasks-1` | Join its site code to the registry and identify the habitat with both rows | core-required | 1 | Core under the question/context basis above. |

### od-099 · holdout

Original question:

> Does the greater 'trace score' establish more individual animals at site B? Explain what the score actually counts.

Context basis: The score counts marked detection intervals, not identified animals; the question explicitly challenges that inference.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-099/required-0` | B has more intervals with detected tracks than A, five versus three | core-required | 1 | Core under the question/context basis above. |
| `od-099/required-1` | The local score counts detection intervals rather than distinct animals | core-required | 1 | Core under the question/context basis above. |
| `od-099/required-2` | More individual animals at B is not established without identity information | core-required | 1 | Core under the question/context basis above. |
| `od-099/tasks-0` | Compare the scores using their local definition | core-required | 1 | Core under the question/context basis above. |
| `od-099/tasks-1` | Assess the proposed inference about individual-animal counts | core-required | 1 | Core under the question/context basis above. |

### od-100 · holdout

Original question:

> Use the extracted table to identify the warmer site, then say what the red shading in the original figure means.

Context basis: Extracted temperatures allow the warmer-site comparison, but no image/shading/legend was captured.

| Key | Original criterion | Classification | coreScope mask | Scope rationale |
| --- | --- | --- | ---: | --- |
| `od-100/required-0` | Valley is warmer at 14 degrees C versus Plateau's 11 degrees C | core-required | 1 | Core under the question/context basis above. |
| `od-100/required-1` | The difference is 3 degrees C | helpful-enrichment | 0 | The user asks which site is warmer and what the unavailable shading means, not the temperature difference. Valley at 14 versus Plateau at 11 answers the comparison; a separate 3-degree calculation is optional. |
| `od-100/required-2` | The meaning of red shading is unavailable without the figure or legend | core-required | 1 | Core under the question/context basis above. |
| `od-100/tasks-0` | Compare temperatures using the extracted cells | core-required | 1 | Core under the question/context basis above. |
| `od-100/tasks-1` | Identify the missing legend as the specific limit on interpreting the red shading | core-required | 1 | Core under the question/context basis above. |
