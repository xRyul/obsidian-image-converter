---
description: Evidence-first P95 workflow for image-converter behaviour fixes/features
argument-hint: "<behaviour / bug / feature to measure>"
---
I want to measure and improve this Obsidian image-converter plugin behaviour:

$ARGUMENTS

Use an evidence-first P95 workflow. Do not implement the fix first.

## Goal
Create or extend a real Obsidian CLI runtime check under `scripts/p95/` that measures this behaviour, records before/current/target metrics, and prevents future regressions. Then implement the smallest root-cause fix or feature change needed to meet the target.

## Required workflow

1. Clarify only if the scenario or expected ideal behaviour is ambiguous.
2. Reproduce/measure first. Do not fix first.
3. Choose a slug and create/extend `scripts/p95/<slug>.mjs`.
4. The P95 script must:
   - run through `obsidian eval` against `plugin-testing-vault`,
   - create its own fixtures under `_pi/p95/`,
   - reload or isolate runtime state when needed,
   - print a metric table with `previous`, `current`, `delta`, `target`, and `PASS/FAIL`,
   - write a current JSON report,
   - append a JSONL history row,
   - support `--no-fail` for known-bad baseline capture,
   - exit non-zero when current metrics miss the target unless `--no-fail` is used.
5. Define ideal target metrics before fixing. Prefer measurable targets such as:
   - max leaked DOM elements `<= 0`,
   - max simultaneously open menus `<= 1`,
   - p95 interaction latency `<= 250ms`,
   - p95 required user actions `<= 1`,
   - accumulated plugin-owned listeners/EventRefs/observers `<= stable expected count`.
6. Run the P95 script before the fix with `--no-fail` and report exact numbers.
7. Add a focused Vitest regression test when the behaviour is testable with mocks.
8. Implement the minimal root-cause fix. Avoid speculative cleanup or broad rewrites.
9. Build/copy/reload the plugin as needed, then rerun the P95 script without `--no-fail`.
10. Show before/current/target numbers and clearly state what improved.
11. Run relevant validation:
    - `node --check scripts/p95/<slug>.mjs`,
    - `npm test` or focused tests first, then full test suite when appropriate,
    - `npm run build`,
    - existing stress scripts if lifecycle/interactions are relevant,
    - `obsidian dev:errors`,
    - `obsidian dev:console level=error`.
12. Do not overclaim. State exactly what was measured and what was not.

## Output format

At the end, summarize:

- P95 script path
- target metrics
- before metrics
- after metrics
- files changed
- validation run
- any remaining untested scenarios
