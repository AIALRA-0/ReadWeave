# ReadWeave writing contract v2

The runtime audit identifies this revision as `format-2026-09-v2`.
The application remains based on Trilium 0.104.0; this is a writing-contract
revision, not an upstream application upgrade.

## Rule sources and runtime scope

The contract was reviewed against the 2026-09-09 local editions of
`human-readable-technical-writing/SKILL.md`, `references/format-rules.md`, and
`references/explanation-framework.md`.
Production imports the compiled TypeScript contract, not a developer's local
skill installation or Python tooling.

| Rule group | Runtime implementation |
| --- | --- |
| FMT-003/008, 067/082 | Preserve source objects; align only annotated code copies with exactly matching statements |
| FMT-023/043 | Hierarchical section guidance; explicit short enumerations split from two items; causal sentences are not blindly split |
| FMT-044/061 | Bilingual names, continuous definition list items, no invented translations or etymologies |
| FMT-083/104 | Object-first explanation guidance for tables, images, quotes, code, and diagrams |
| FMT-105/110, EXPL-001/014 | Reader prerequisites, worked examples, conditions, source distinctions, and same-writer review |

Definitions receive their answer-order guide as one continuous explanation,
not five section instructions. Plain definition paragraphs may be joined by
punctuation; mixed-media definitions are not flattened.

For code explanations, the selected original can be restored before a comment
copy only when every statement matches. Automatic comment alignment currently
handles Python, JavaScript, and TypeScript copies. It does not guess how to
rewrite unmatched code or parse every programming language.

Formatting suggestions remain non-blocking. The existing maximum of two local
repairs is unchanged; this update adds no model calls or search calls by itself.

## Verification

On 2026-09-09:

- The format, unified writer, writer-budget, and budget suites passed 180 tests
- The 43 previously retired multi-stage tests remain unchanged; no new skips
- Server application and server test TypeScript builds passed
- The server production build passed
- Five real-model checks covered a definition, conditional procedure,
  calculation, code explanation, and summary
- Each final live case used one `deepseek-v4-flash` call and no paid search
- Final live-case estimates totalled CNY 0.011936, not a supplier invoice
- Actual prompts, answers, credentials, and private logs are not published

The committed regression tests are in `readweave_format.spec.ts` and
`readweave_unified_ai.spec.ts`. Local execution records remain in the ignored
test-output directory.

## Observed limits

The live assertions verify selected requirements, not universal writing quality.
Human inspection still found inconsistent heading depth, an unformatted numeric
expression inside code explanation prose, and occasionally redundant procedural
sections. These are not represented as fully solved or mechanically validated.

The whole-workspace typecheck reported an unrelated desktop `RequestProvider`
interface mismatch. Existing lint and line-length findings outside changed
lines were not repaired as part of this writing-only update.
