# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `plan_rollback` MCP tool and `plan`
  CLI command producing a release rollback plan from the
  release's diff.
- Steps in one pinned order — feature flags in input
  order, then env changes in input order, then migrations
  in reverse input order (last applied, first rolled
  back) — each step carrying its 1-based order, kind,
  action, target, exact detail string, and risk.
- Every flag branch (enabled / disabled / added / removed),
  every env branch (added, and changed / removed with the
  pre-release value known or not), and every migration
  branch (compensating `down_id`, which takes precedence
  over `reversible`; reversible down migration; blocked
  irreversible migration) covered, with manual and blocked
  steps counted by risk and `safe` true exactly when
  nothing is blocked.
- Path-naming validation errors for malformed input, and
  no partial plan on invalid input. The tool plans only:
  it executes nothing.
