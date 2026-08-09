---
purpose: Cross-surface integration regressions, plus future real-DB and mock-provider suites.
blueprint_source: "docs/product/repository-blueprint-handoff-package.md §14"
status: partially-implemented
implemented_files:
  - lady-macbeth-macbeth.test.mjs
planned_files:
  - parsing/
  - versioning/
  - rendering/
---

# test/integration/

## Purpose

Focused dependency-free regressions can exercise product assets and local tools across surfaces. The
first such test verifies the Lady Macbeth / Macbeth score, generated timing pack, registrations, and
safe renderer/mixer refusal behavior.

Future feature integration tests run against real Postgres (via Docker Compose in dev, via the CI
service container in CI) and **mock** voice/storage adapters. They cover the three trust areas the
blueprint identifies (§14):

- `parsing/` — Parser correctness across edge cases.
- `versioning/` — Atomic version creation, immutability invariant.
- `rendering/` — Render lifecycle from queue → in_progress → completed (or failed) using `mock.adapter`.

## Tooling

Current focused runner: Node's built-in `node:test` through `pnpm test`.

The first database-backed TypeScript suite can decide whether Vitest adds enough value to justify a
second runner; do not require it for dependency-free JavaScript asset/tool checks.

Database fixture: each test isolates via a per-test transaction that rolls back, or a per-test schema, depending on parallelism needs. Decided at first test.

## What does NOT go here

- Anything touching real external APIs. Use mock adapters or temp-file CLI guards.
- E2E browser tests — those are `test/e2e/`.
- Unit tests — co-locate with source.
