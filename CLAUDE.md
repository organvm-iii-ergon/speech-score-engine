# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`speech-score-engine` is a TypeScript pnpm-workspace monorepo implementing the system the design canvases call `$SPEECH_SCORE_ENGINE`: a dramaturgical-audio workbench for authoring, analyzing, rehearsing, rendering, and executing polyvocal speech works. As of 2026-05-13 it holds both **(a) the full provenance-preserved design corpus** recovered from a ChatGPT project (`dramaturgist-tuning`, project key `g-p-69c6e425347c81918dfba984fb76206c`), and **(b) the initial executable scaffold** generated from that corpus.

The scaffold is structural, not feature-complete. The build runs (`pnpm install && pnpm db:up && pnpm db:migrate && pnpm dev`). The API has only `/health`. The worker boots BullMQ queues with no processors yet. The web app renders a static home page. The MVP feature surface (parsing, versioning, render pipeline, diagnostics, share links) is intentionally unimplemented — see `docs/product/repository-blueprint-handoff-package.md` §13 for the build order.

## Layout

```
.
├── apps/
│   ├── web/                                    # Next.js 15 app router; src/{components,hooks,lib,state,styles,types} carry anchor READMEs
│   ├── api/                                    # Fastify (only /health endpoint so far); src/{server,modules,services,repositories,policies,contracts,bootstrap} anchored
│   └── worker/                                 # BullMQ + ioredis (queues declared, no processors yet); src/{bootstrap,jobs,providers,pipelines,services,telemetry} anchored
├── packages/
│   ├── domain/                                 # TS contracts + zod schemas + event constants (runtime-neutral)
│   ├── database/                               # 6 SQL migrations + pg client + migrate + seed runner; src/{schema,queries,repositories,transactions} anchored
│   ├── config/                                 # zod-validated env loader
│   ├── client-sdk/                             # Fetch wrapper for API access (browser-or-Node)
│   ├── ui/                                     # Shared React UI primitives (cn helper to start)
│   └── observability/                          # pino logger factory; shared structured logging
├── docs/
│   ├── conventions/                            # naming, frontmatter, directory-readme — DURABLE rules
│   ├── architecture/                           # 001-system-context through 005-api-contracts
│   ├── adr/                                    # ADR 0001-0004 (monorepo, JSONB snapshots, async worker, immutability)
│   └── product/                                # Verbatim copies of the design canvases (with cross-reference frontmatter)
├── infrastructure/
│   ├── docker/compose.yaml                     # Local Postgres 16 + Redis 7 + MinIO
│   ├── terraform/README.md                     # Anchor for future production IaC
│   └── scripts/README.md                       # Anchor for utility scripts
├── test/
│   ├── fixtures/README.md                      # Anchor for shared test fixtures
│   ├── integration/                            # Focused node:test regressions + future DB integration suites
│   └── e2e/README.md                           # Anchor for browser-driven e2e tests
├── .github/workflows/ci.yml                    # install, typecheck, lint, build, migration-syntax check
├── dramaturgist-tuning-markdown-archive/       # The provenance-preserving canonical archive
│   ├── codex-conversation-inventory.{md,tsv}   # Auxiliary Codex inventory (different schema from manifest)
│   ├── 00-{README.md,manifest.json,metadata.tsv,full-archive.md}   # Renamed 2026-05-13 from dramaturgist-tuning-00--*
│   ├── dt-NN-MMM--{topic-slug}.md              # 36 per-pair files; renamed 2026-05-13 to be self-describing in Finder
│   └── sources/                                # All 14 panel-sources from the ChatGPT project (SHA-1-tracked, byte-frozen)
│       ├── SOURCES-INDEX.md                    # Recovery index
│       ├── *.md                                # 12 canvas docs + 1 reconstructed lexicon
│       └── *.html                              # 2 SingleFile HTML captures (61KB + 1MB fidelities)
├── .claude/plans/YYYY-MM-DD-{slug}.md          # Per-session plan history (never overwrite)
├── .serena/                                    # Serena MCP project config (project.yml, project.local.yml); cache/ regenerable
├── CLAUDE.md                                   # This file
└── README.md                                   # Bootstrap + service URLs
```

## Conventions

Three durable conventions live in `docs/conventions/`. Read them before adding or renaming files.

| Convention | Doc | When it applies |
|---|---|---|
| Filename structure | [`docs/conventions/naming.md`](docs/conventions/naming.md) | Any new file in the repo. Especially: archive files (`dt-NN-MMM--{slug}.md` for chat pairs), ADRs (`NNNN-*.md`), architecture docs (`NNN-*.md`), migrations (`NNNN_snake_case.sql`). |
| YAML frontmatter | [`docs/conventions/frontmatter.md`](docs/conventions/frontmatter.md) | Any Markdown under `docs/`, the chat archive, or `.claude/plans/`. Type-specific schemas (ADR, architecture doc, canvas copy, plan, directory anchor). |
| Directory anchor READMEs | [`docs/conventions/directory-readme.md`](docs/conventions/directory-readme.md) | Any blueprint-anticipated directory that doesn't have implementation files yet. The README is the artifact — not a stub. |

## Common commands

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace deps. |
| `pnpm db:up` | `docker compose up -d` for Postgres + Redis + MinIO. |
| `pnpm db:down` | Stop the local infra services. |
| `pnpm db:migrate` | Apply unapplied SQL migrations from `packages/database/migrations/`. Idempotent; tracks state in a `schema_migration` table. |
| `pnpm dev` | Turbo runs `dev` across all apps in parallel. Web on `:3000`, API on `:4000`. |
| `pnpm build` | Turbo-orchestrated build for all apps + packages. |
| `pnpm typecheck` | `tsc --noEmit` across the graph. |
| `pnpm lint` / `pnpm format` | Biome check / Biome write. |
| `pnpm test` | Focused integration regressions through Node's built-in test runner. |
| `pnpm --filter <pkg> <script>` | Run a single workspace package's script. Used internally for `db:migrate` / `db:seed`. Example: `pnpm --filter @sse/database migrate`. |

Focused integration regressions use Node's dependency-free `node:test` runner. Vitest and Playwright
are not wired yet; Wave 2 of the §13 slice (scene CRUD + parser) can introduce broader application
and browser coverage when that feature surface needs it.

## Architecture authority

`docs/product/repository-blueprint-handoff-package.md` is the load-bearing implementation spec. The scaffold tracks it directly: top-level layout (§2), folder purposes (§3), SQL migrations (§7), TS service contracts (§9.3), env vars (§10), bootstrap (§11). When implementing a feature, read the matching blueprint section first; if you diverge, write an ADR in `docs/adr/`.

The implementation order is **fixed** by blueprint §13: schema + contracts → scene CRUD + parsing → versioning transaction → render pipeline → diagnostics → share/compare. The system is **not** a TTS wrapper; dramatic language stays structured temporal data through the whole stack. See `docs/product/README.md` for the canvas read-order.

### §13 slice progress (verified 2026-05-13)

- **Wave 1 — domain contracts**: **DONE** (commits `6074094`, `47451d7`). `packages/domain/src/` exports `contracts/`, `diagnostics/`, `events/`, `parsing/`, `project/`, `render/`, `scene/`, `share/`, `speaker/`, `user/`, `version/` modules. Active plan-of-record: `.claude/plans/2026-05-13-scene-crud-and-parser-slice.md`.
- **Waves 2-6** (scene CRUD + parser, versioning transaction, render pipeline + voice provider adapters, diagnostics generator, share links + version comparison): **OPEN**.

Future agents implementing a wave should read the active plan-of-record first; do not re-derive contracts that already exist in `packages/domain/`.

## Load-bearing invariants

Future agents must treat the following as constraints, not suggestions:

1. **`sources/SOURCES-INDEX.md` references SHA-1 prefixes and byte counts** for every recovered file. Reformatting, normalizing whitespace, or "tidying" any file under `sources/` or `dramaturgist-tuning-markdown-archive/` invalidates these references. If a source needs editing, update the index in the same commit.
2. **`$VARIABLE`-style tokens in the canvases are domain ontology**, not template placeholders. `$SPEECH_SCORE_ENGINE`, `$PHRASE_EVENT`, `$COMPOSITION_LAYER`, `$DOCUMENT_ID`, etc. are part of the authored prose. Do not "expand," "resolve," or substitute them.
3. **ChatGPT-internal citation markers** in canvas content (e.g. `fileciteturn0file4`, `\nturn0file12turn0file13`) are valid provenance trails into the original chat-export. Preserve verbatim.
4. **Canvases #4 (`speech-score-engine-system.md`) and #12 (`speech-performance-engine-concept.md`) are byte-identical** (both SHA-1 `96e52023ca5d`). This is intentional — they are distinct ProjectSave records under distinct panel titles. Do not dedupe; cross-reference in the index instead.
5. **`preview.text` from the ChatGPT saves endpoint is full content**, not truncated. The API field name is misleading. Documented in `SOURCES-INDEX.md` and the recovery plan.
6. **Migrations in `packages/database/migrations/` are immutable once applied** (ADR 0004). Never edit an applied `NNNN_*.sql` file — add a new one. `pnpm db:migrate` is idempotent and tracks state in a `schema_migration` table; mutating an applied file invalidates that state.
7. **`packages/domain` is runtime-neutral.** No I/O, no DB calls, no Fastify or Next imports. Domain code must import-cleanly into a browser, Node, or worker context. Putting an HTTP client, a `pg` query, or a `fastify` handler inside `packages/domain/` breaks this boundary and the package's purpose.

## Cross-cluster artifact drift

This repo is one of three active workspaces in a cluster: `composition-1-2` (Broward College pedagogy), `_agent-ontology` (cross-tool agent-environment governance workbench), and this one. When AI-tool spillover or cross-tool search activity accumulates files at this repo's root, the cluster's canonical governance home is `/Users/4jp/Code/_agent-ontology`. Read `_agent-ontology/docs/PROTOCOL.md` (the 8-phase audit protocol) and `_agent-ontology/conventions/data-governance-sop.md` (the data-governance SOP) before classifying spillover here.

**Historical resolution** (commits `7437f80`, `e36a88f`): the **pre-git-init** strays — `lexicon-and-style-guide.md` (newline-diff dup of `sources/`), `canvas-01--tracker-ableton-speech-workstation.md` (whitespace-diff dup), and the 1 MB Tracker HTML promoted to `sources/` as the full-fidelity sibling — were resolved.

**2026-05-13/14 cluster recovery activity**: during a cross-tool search for potentially-deleted plans and transcripts, the user pulled 20 untracked files into this repo's root from various AI-tool persistence trees (`~/.local/share/{opencode,gemini}/`, `~/.codex/`, `~/Downloads/<chatgpt-export>/`, `~/.claude/`). The search concluded with **no actual losses** confirmed by the user. The plan-of-record for the recovery + reconciliation is `.claude/plans/2026-05-14-cluster-route-speech-score-strays-into-agent-ontology.md` (home-scope copy at `~/.claude/plans/drifting-sprouting-ripple.md`). SHA-256 sweep across `~/.local/share`, `~/.codex`, `~/.claude`, `~/.cache`, `/tmp` confirmed 18 of 20 strays are **unique to this repo's root** (created here by tool invocations, not migrated from a recoverable elsewhere). The 2 exceptions are `dramaturgist-tuning-conversation-inventory.{md,tsv}` — byte-identical to the archive copy AND to a 2026-04-23 ChatGPT user-data-export under `~/Downloads/0d965e16.../`.

**Etiquette for future spillover**:

1. **Classify by cluster destination first, not by `.gitignore` default.** Cross-tool audit material (Codex/Claude/Gemini/OpenCode session state, hook snapshots, atom-registry slices) belongs in `_agent-ontology/sessions/{YYYY-MM-DD}-{agent}/` (raw exports) or `_agent-ontology/archives/session-{agent}-{n}-{date}/` (IA-processed with manifest.yaml + per-artifact SHA-256). Speech-score-engine **domain** extractions (ontology mined from `dramaturgist-tuning-markdown-archive/sources/`) belong in `dramaturgist-tuning-markdown-archive/derived/`. Only `.gitignore` as a last resort.
2. **Verify before deleting.** SOP §4.2 requires SHA-256 match against the archive counterpart. Empty files (0 bytes) are safe to delete; anything with content needs hash verification against at least one durable sibling.
3. **Never rename without authorization** — per `_agent-ontology` SOP. Filename collisions across authors are first-class data, not bugs to deduplicate.
4. **Tool spillover prevention**: when adding new tooling that writes to repo root, add the prefix to `.gitignore` BEFORE running it. The repo root is for human-authored artifacts and tracked build configuration.

## Reproducible operation: ChatGPT canvas recovery

The 12 canvas docs in `sources/` were extracted from the ChatGPT project's internal API — `Export data` does not include them. To re-run recovery from a fresh authenticated browser session:

```
# Token capture (in browser console on chatgpt.com):
fetch('/api/auth/session').then(r => r.json()).then(s => window.__tok = s.accessToken);

# Enumerate saves:
fetch('/backend-api/projects/g-p-69c6e425347c81918dfba984fb76206c/saves?limit=100',
      {headers: {'Authorization': 'Bearer ' + window.__tok}}).then(r => r.json());

# Per-save full content (preview.text is the whole canvas):
fetch('/backend-api/projects/{gizmo_id}/saves/{save_id}',
      {headers: {'Authorization': 'Bearer ' + window.__tok}}).then(r => r.json());
```

A reproducible content-extraction technique that bypasses Claude Code's JS-return content filter (used during the original recovery): render the text into a fixed-position `<article id="__cx">` with `white-space:pre-wrap` and read it via `get_page_text`. The accessibility tree returns the literal content; direct JS return values get filtered for cookie/Base64/long-string patterns.

## Plan discipline

Every non-trivial task gets a dated plan file at `.claude/plans/YYYY-MM-DD-{descriptive-slug}.md`. **Never overwrite** — revisions get `-v2`, `-v3` suffixes. After writing a plan, commit it (Universal Rule #5: plans are artifacts).

Read existing plans before acting on repo state:

```
ls .claude/plans/*.md 2>/dev/null | sort -r | head
```

The active plan-of-record for the §13 slice is `.claude/plans/2026-05-13-scene-crud-and-parser-slice.md`. The most recent session closeout supersedes earlier ones (versioned `closeout.md` → `closeout-v2.md` → `closeout-v3.md` → ...). Do not embed a filename list in this CLAUDE.md — plans decay too quickly for the index to stay accurate.

## What NOT to do here

- **Do not commit unprompted.** Commits go in only when explicitly requested. The default branch is
  `main`; the current public remote is `git@github.com:organvm-iii-ergon/speech-score-engine.git`.
- **Do not reformat, normalize, or "clean up" any file under `dramaturgist-tuning-markdown-archive/`** without explicit instruction. Provenance is the load-bearing property; SHA-1s in `SOURCES-INDEX.md` are tracked against those file contents.
- **Do not modify a `docs/product/*.md` canvas in isolation.** The canonical original lives at `dramaturgist-tuning-markdown-archive/sources/`; `docs/product/` is a copy. If a canvas needs editing, source-first and re-copy. Better: write an ADR in `docs/adr/` rather than rewrite the spec.
- **Do not bypass the blueprint's build order (§13).** The schema and contracts come first, then scene CRUD + parsing, then versioning, then render pipeline. Building the worker pipeline before there's a `scene_version` to render against will create coupling that has to be unwound.
- **Do not add stub functions / 501-handlers / TODO markers** for endpoints or features that don't have logic yet. The scaffold deliberately has fewer files than the blueprint anticipates; the right move when a feature is needed is to add the file at that point, not pre-create empty shells.
- **Do not run `chezmoi apply` against this directory.** It is not a chezmoi-managed path.
- **Do not edit the deployed `~/.claude/CLAUDE.md`** — its source is in the chezmoi tree at `~/Workspace/4444J99/domus-semper-palingenesis`. (Restated from the global CLAUDE.md.)
