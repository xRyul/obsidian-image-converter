# P95 Obsidian runtime checks

This directory holds Obsidian CLI checks that measure real plugin behaviour in a running Obsidian instance.

Each script should:

- create its own fixture data under `_pi/` in the target vault,
- run through `obsidian eval`, not Vitest mocks,
- print current metrics against an explicit ideal target,
- keep the previous report so a second run shows before/after deltas,
- exit non-zero when current metrics miss the target.

Use `--no-fail` when intentionally capturing a known-bad baseline before a fix.

Example:

```bash
node scripts/p95/context-menu-escape.mjs --vault plugin-testing-vault --id image-converter --no-fail
# apply/build/copy a fix
node scripts/p95/context-menu-escape.mjs --vault plugin-testing-vault --id image-converter
```
