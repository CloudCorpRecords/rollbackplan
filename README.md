# rollbackplan

Rolling a release back under pressure is where ordering
mistakes happen: a migration is undone before the flag that
depends on it is off, or a dropped column turns out to be
the one nobody can reconstruct. rollbackplan takes the
release diff you already have and turns it into an ordered
plan before anyone touches anything — **flags first, then
env, then migrations backwards**.

You supply three parts of the diff: the feature flags the
release touched, the environment variable changes it made,
and the migrations it applied, in application order. The
plan walks them in the only order that is safe to undo a
release in:

- **Feature flags, in input order.** A flag the release
  enabled is disabled, one it disabled is re-enabled, one
  it added is removed. A flag it *removed* cannot simply be
  flipped back, so that step is flagged **manual**: someone
  has to recreate it in its pre-release state.
- **Environment changes, in input order.** A variable the
  release added is unset. For a changed or removed
  variable, the step restores the recorded pre-release
  value when there is one; when `previous_value_known` is
  false the step is flagged **manual**, because the old
  value has to be found by a person.
- **Migrations, in reverse input order** — the last one
  applied is the first one rolled back. A migration with a
  compensating `down_id` runs that migration (the
  `down_id` wins, even over `reversible: false`), and a
  reversible migration runs its own down migration. An
  irreversible migration with no compensating migration
  is flagged **blocked**: manual data recovery is required,
  and the plan's `safe` field is `false` exactly while any
  blocked step exists.

Every step carries its position (`order`, 1-based), its
kind, the action to take, its target, an exact instruction
(`detail`), and its risk — `normal`, `manual`, or
`blocked`. The result also counts the steps overall and
per kind, and counts the manual and blocked steps by risk,
so a caller can gate on `safe` before a human starts
working through the list.

The plan is advice, not action: rollbackplan executes
nothing. It does not run a migration, flip a flag, or touch
an environment. The computation is pure and local — no
network, no configuration, no files read beyond the input
you pass in.

Malformed input — a missing, empty, or non-string
`release`, a list that is not an array, an entry that is
not an object, a missing, empty, or duplicated migration
`id` or variable / flag `name`, an `action` or `change`
outside its enum, a wrongly typed `reversible` or
`previous_value_known`, or an empty `down_id` — is a
validation error naming the offending path (for example
`migrations[2].id duplicates migrations[0].id "add_orders"`),
and no partial plan is produced.

## CLI

```bash
npx @reneturcios/rollbackplan plan --input args.json
npx @reneturcios/rollbackplan --version
```

`args.json` contains the full arguments object:

```json
{
  "release": "v2.4.0",
  "feature_flags": [
    { "name": "checkout-v2", "change": "enabled" },
    { "name": "old-banner", "change": "removed" }
  ],
  "env_changes": [
    { "name": "TIMEOUT_MS", "action": "changed", "previous_value_known": true },
    { "name": "LEGACY_TOKEN", "action": "removed" }
  ],
  "migrations": [
    { "id": "add_orders_table" },
    { "id": "backfill_orders", "down_id": "clear_backfill" },
    { "id": "drop_legacy_table", "reversible": false }
  ]
}
```

`migrations`, `env_changes`, and `feature_flags` are each
optional and default to `[]`; `reversible` defaults to
`true` per migration and `previous_value_known` defaults
to `false` per env change. All three lists may be empty:
the plan then has no steps and `safe` is `true`. The plan
is printed as JSON:

```json
{
  "release": "v2.4.0",
  "steps": [
    { "order": 1, "kind": "feature_flag", "action": "disable", "target": "checkout-v2", "detail": "Disable feature flag checkout-v2 (enabled by this release)", "risk": "normal" },
    { "order": 2, "kind": "feature_flag", "action": "restore", "target": "old-banner", "detail": "Feature flag old-banner was removed by this release; recreate it in its pre-release state", "risk": "manual" },
    { "order": 3, "kind": "env", "action": "set", "target": "TIMEOUT_MS", "detail": "Restore environment variable TIMEOUT_MS to its recorded pre-release value", "risk": "normal" },
    { "order": 4, "kind": "env", "action": "restore", "target": "LEGACY_TOKEN", "detail": "Environment variable LEGACY_TOKEN was removed by this release and its pre-release value is not recorded; restore it manually", "risk": "manual" },
    { "order": 5, "kind": "migration", "action": "manual", "target": "drop_legacy_table", "detail": "Migration drop_legacy_table is irreversible and has no compensating migration; manual data recovery is required", "risk": "blocked" },
    { "order": 6, "kind": "migration", "action": "run_down_migration", "target": "clear_backfill", "detail": "Run compensating migration clear_backfill to undo backfill_orders", "risk": "normal" },
    { "order": 7, "kind": "migration", "action": "run_down_migration", "target": "add_orders_table", "detail": "Run the down migration for add_orders_table", "risk": "normal" }
  ],
  "counts": { "steps": 7, "feature_flags": 2, "env_changes": 2, "migrations": 3, "manual": 2, "blocked": 1 },
  "safe": false
}
```

Exit codes: `0` on success, `1` on a runtime error (including
an unreadable or invalid input file, or invalid input), `2`
on a usage error.

## MCP server

```bash
npx -y @reneturcios/rollbackplan mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "rollbackplan": {
      "command": "npx",
      "args": ["-y", "@reneturcios/rollbackplan", "mcp"]
    }
  }
}
```

### Tools

- `plan_rollback` — Plan a release rollback from its diff.
  - `release` (string, required, non-empty) — the release
    identifier or version being rolled back
  - `migrations` (array, optional, default `[]`) —
    migrations in application order, as
    `{id, reversible?, down_id?}` objects; `id` is unique
    across the set and `reversible` defaults to `true`
  - `env_changes` (array, optional, default `[]`) —
    changes as `{name, action, previous_value_known?}`
    objects; `action` is one of `added`, `changed`,
    `removed`, and `previous_value_known` defaults to
    `false`
  - `feature_flags` (array, optional, default `[]`) —
    changes as `{name, change}` objects; `change` is one
    of `enabled`, `disabled`, `added`, `removed`

  Returns `{release, steps, counts, safe}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/rollbackplan
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/rollbackplan plan --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
