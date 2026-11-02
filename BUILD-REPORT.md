# rollbackplan — Build Report

MCP Rebuild 1000, Batch 16. Original program build from the
packages-100 plan (cluster E #60), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch16/rollbackplan.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `rollbackplan`, npm `@reneturcios/rollbackplan`,
MCP name `io.github.CloudCorpRecords/rollbackplan`, version
`0.1.0`, bin `rollbackplan` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Plan a release
  rollback: flags first, then env changes, then migrations
  in reverse order." — 89 chars, verified by direct count;
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/rollbackplan:0.1.0` carries
  **no** `version` field), `Dockerfile` (node:20-alpine
  two-stage, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/rollbackplan"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`plan --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/rollbackplan.ts` (core,
  `VERSION = "0.1.0"`)
- `test/rollbackplan.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/rollbackplan`,
  smoke-test server-name assertion `rollbackplan`)

Plus the parity fixture at
`harness/fixtures/rollbackplan-tools-original.json`
(`_source` labels it a program spec from the packages-100
plan, cluster E #60).

## Tools implemented (1)

- `plan_rollback` — arguments: `release` (string, required,
  non-empty) plus three optional lists, each defaulting to
  `[]`: `migrations` (in application order) of
  `{id (string, required, non-empty, unique),
  reversible (boolean, optional, default true),
  down_id (string, optional, non-empty)}`; `env_changes` of
  `{name (string, required, non-empty, unique),
  action (enum added / changed / removed, required),
  previous_value_known (boolean, optional, default false)}`;
  and `feature_flags` of
  `{name (string, required, non-empty, unique),
  change (enum enabled / disabled / added / removed,
  required)}`.

  Steps are built in the spec's pinned order: all
  feature-flag steps in input order, then all env steps in
  input order, then all migration steps in REVERSE input
  order (last applied, first rolled back). Each step is
  `{order (1-based), kind, action, target, detail, risk}`
  with the spec's exact detail strings:

  - Flags (kind `feature_flag`, target = flag name):
    enabled → `disable`; disabled → `enable`; added →
    `remove`; removed → `restore` with risk `manual`.
  - Env (kind `env`, target = variable name): added →
    `unset`; removed or changed with
    `previous_value_known` → `set` restoring the recorded
    pre-release value; removed or changed without it →
    `restore` with risk `manual` and the per-action detail
    wording ("was removed by this release" vs "was changed
    by this release").
  - Migrations (kind `migration`, reversed): `down_id`
    present → `run_down_migration` targeting the `down_id`
    ("Run compensating migration <down_id> to undo <id>");
    else reversible → `run_down_migration` targeting the
    `id`; else → action `manual`, risk `blocked`, target
    the `id` (see Gaps). A present `down_id` takes
    precedence over `reversible`, including
    `reversible: false`.

  Returns `{release, steps, counts, safe}` where counts =
  `{steps, feature_flags, env_changes, migrations, manual,
  blocked}` (manual / blocked counted by step risk) and
  `safe` is true exactly when blocked is 0. All three lists
  may be empty: steps is then `[]` and `safe` is `true`.
  The tool plans only — it executes nothing; the
  computation is pure and local.

  The fixture literal
  (`harness/fixtures/rollbackplan-tools-original.json`) and
  the `src/mcp.ts` literal are identical, enums included,
  with no `$schema` and no `additionalProperties` —
  confirmed by the parity run below.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation; the core takes the full
  arguments object (`{release, migrations?, env_changes?,
  feature_flags?}`).
- Validation is path-naming and total: a missing / empty /
  non-string `release`, a list present but not an array, an
  entry that is not an object, a missing / empty /
  non-string or duplicated `id` / `name` (the error names
  the second occurrence's path, e.g.
  `migrations[2].id duplicates migrations[0].id "dup"`), a
  missing `action` / `change` or one outside its enum, a
  non-boolean `reversible` / `previous_value_known`, or an
  empty / non-string `down_id` throws an Error naming the
  offending path and produces no partial result (MCP:
  `isError`; CLI: exit 1). Uniqueness is per list: the
  same string used as a migration id, an env name, and a
  flag name is not a duplicate. Validation order (a pinned
  judgement call, see Gaps): `release` first, then
  `migrations`, then `env_changes`, then `feature_flags`,
  each in input order.

## Verification (foreground, this session)

- `npm test` (`tsx --test test/*.test.ts`): **50 tests,
  50 pass, 0 fail** — the dedicated ordering pins (flags in
  input order → env in input order → migrations in exact
  reverse input order, with 1-based orders; flag and env
  steps provably not sorted); every flag branch with its
  exact detail (enabled / disabled / added / removed);
  every env branch with its exact detail (added; removed
  and changed each with `previous_value_known` true, false,
  and omitted-defaulting-to-false); every migration branch
  (down_id, down_id precedence over `reversible: false`
  and over `reversible: true`, reversible explicit and
  defaulted, irreversible blocked with exact detail); a
  full exact-result match for a mixed release; counts
  (per-kind totals, manual / blocked counted by risk, a
  blocked step's action `manual` not counted as manual
  risk), `safe` true with manual-only steps and false
  exactly when blocked is non-zero; the all-lists-empty
  case (both explicit `[]` and omitted) with steps `[]`
  and `safe` true; and every validation path (release
  missing / empty / non-string, each list non-array,
  non-object entries in each list, missing / empty /
  non-string `id` and `name` in each list, duplicate
  `id` / `name` naming the second occurrence in each list,
  cross-list name reuse allowed, `action` / `change`
  missing and outside-enum, non-boolean `reversible` and
  `previous_value_known` naming their exact paths,
  `down_id` empty and non-string, and no partial result on
  invalid input).
- `npx tsc --noEmit` → exit 0; `npm run build` → exit 0
  with all 15 `dist/` outputs present.
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `plan` with no `--input` exits 2;
  `plan --input <missing file>` exits 1 naming the file;
  `plan --input <valid file>` exits 0 and prints the plan
  JSON (verified against a hand-checked set: an enabled
  flag disabled, a changed env var with a known previous
  value set, migrations reversed with an irreversible one
  blocked ahead of a reversible one, counts 4 / 1 / 1 / 2
  / 0 / 1, `safe: false`); `plan --input <invalid file>`
  exits 1 with
  `migrations[1].id duplicates migrations[0].id "dup"`.
- Parity: `harness/parity.py` vs
  `harness/fixtures/rollbackplan-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with
  the rebuild path as an absolute path; the harness does
  not expand a `~` inside the quoted stdio command
  string). Report saved under `parity-out/`.

## Lockfile status

`package-lock.json` generated clean via Route 3 (in the
build dir with no `node_modules` present,
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/rollbackplan`, **128 package entries**
(`@modelcontextprotocol/sdk` 1.32.2, `zod` 3.25.76, `tsx`
4.23.15, `typescript` 5.9.3, `@types/node` 20.19.43,
`qs` 6.17.0).

## Gaps / honest notes

- **Blocked-migration target (spec silence, judgement
  call):** the spec names the target explicitly for the
  other two migration branches (the `down_id`, and the
  `id` for a reversible migration) but not for the
  irreversible branch. The blocked step targets the
  migration's own `id` — the only target that identifies
  what needs manual recovery. Pinned by a dedicated test.
- **Pinned judgement calls** (each with a dedicated test
  where applicable): (1) validation order — `release`,
  then `migrations`, then `env_changes`, then
  `feature_flags`, matching the spec's schema order, so a
  bad migration is reported before a bad env entry;
  (2) unknown extra fields, at the top level and per
  entry, are ignored rather than rejected (the spec does
  not forbid them); (3) a non-object top-level arguments
  value is treated as an empty object, so it fails as
  `release is required`; (4) duplicate wording is not
  fixed by the spec (only that the error names the second
  occurrence's path); the messages used are
  `<list>[<i>].<key> duplicates <list>[<first>].<key> "<value>"`,
  matching the fleet pattern; (5) a blocked step's action
  string is `manual` per the spec, but it is counted
  under `blocked`, not `manual`, because counts.manual /
  blocked count steps by risk. No other spec ambiguity
  was found in the core behaviour; the spec's
  server.json description count (89 chars) was verified
  exact by direct count.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
