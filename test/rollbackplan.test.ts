import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planRollback } from "../src/rollbackplan.js";

/**
 * All tests are pure local computation over inline release
 * diffs: no filesystem, no network, and nothing is executed.
 * The pinned step ordering (flags in input order, then env
 * in input order, then migrations in reverse input order)
 * is pinned with dedicated tests, every flag / env /
 * migration branch is pinned with its exact detail string,
 * the manual / blocked counting and the safe flag are
 * pinned, and every validation path is pinned with its
 * path-naming message.
 */

type Input = Record<string, unknown>;

const plan = (over: Input = {}) => planRollback({ release: "v2.4.0", ...over });

describe("planRollback — feature flag branches, exact details", () => {
  it("enabled -> disable, normal", () => {
    const out = plan({ feature_flags: [{ name: "new-ui", change: "enabled" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "feature_flag",
        action: "disable",
        target: "new-ui",
        detail: "Disable feature flag new-ui (enabled by this release)",
        risk: "normal",
      },
    ]);
  });

  it("disabled -> enable, normal", () => {
    const out = plan({ feature_flags: [{ name: "legacy", change: "disabled" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "feature_flag",
        action: "enable",
        target: "legacy",
        detail: "Re-enable feature flag legacy (disabled by this release)",
        risk: "normal",
      },
    ]);
  });

  it("added -> remove, normal", () => {
    const out = plan({ feature_flags: [{ name: "beta", change: "added" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "feature_flag",
        action: "remove",
        target: "beta",
        detail: "Remove feature flag beta (added by this release)",
        risk: "normal",
      },
    ]);
  });

  it("removed -> restore, manual", () => {
    const out = plan({ feature_flags: [{ name: "old-flag", change: "removed" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "feature_flag",
        action: "restore",
        target: "old-flag",
        detail:
          "Feature flag old-flag was removed by this release; recreate it in its pre-release state",
        risk: "manual",
      },
    ]);
  });
});

describe("planRollback — env branches, exact details", () => {
  it("added -> unset, normal", () => {
    const out = plan({ env_changes: [{ name: "NEW_KEY", action: "added" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "env",
        action: "unset",
        target: "NEW_KEY",
        detail: "Remove environment variable NEW_KEY (added by this release)",
        risk: "normal",
      },
    ]);
  });

  it("removed with previous_value_known true -> set, normal", () => {
    const out = plan({
      env_changes: [{ name: "OLD_KEY", action: "removed", previous_value_known: true }],
    });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "env",
        action: "set",
        target: "OLD_KEY",
        detail: "Restore environment variable OLD_KEY to its recorded pre-release value",
        risk: "normal",
      },
    ]);
  });

  it("removed with previous_value_known false -> restore, manual", () => {
    const out = plan({
      env_changes: [{ name: "OLD_KEY", action: "removed", previous_value_known: false }],
    });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "env",
        action: "restore",
        target: "OLD_KEY",
        detail:
          "Environment variable OLD_KEY was removed by this release and its pre-release value is not recorded; restore it manually",
        risk: "manual",
      },
    ]);
  });

  it("removed with previous_value_known omitted defaults to false -> restore, manual", () => {
    const out = plan({ env_changes: [{ name: "OLD_KEY", action: "removed" }] });
    assert.equal(out.steps[0].action, "restore");
    assert.equal(out.steps[0].risk, "manual");
  });

  it("changed with previous_value_known true -> set, normal", () => {
    const out = plan({
      env_changes: [{ name: "LIMIT", action: "changed", previous_value_known: true }],
    });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "env",
        action: "set",
        target: "LIMIT",
        detail: "Restore environment variable LIMIT to its recorded pre-release value",
        risk: "normal",
      },
    ]);
  });

  it("changed with previous_value_known false -> restore, manual", () => {
    const out = plan({
      env_changes: [{ name: "LIMIT", action: "changed", previous_value_known: false }],
    });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "env",
        action: "restore",
        target: "LIMIT",
        detail:
          "Environment variable LIMIT was changed by this release and its pre-release value is not recorded; restore it manually",
        risk: "manual",
      },
    ]);
  });

  it("changed with previous_value_known omitted defaults to false -> restore, manual", () => {
    const out = plan({ env_changes: [{ name: "LIMIT", action: "changed" }] });
    assert.equal(out.steps[0].action, "restore");
    assert.equal(out.steps[0].risk, "manual");
  });
});

describe("planRollback — migration branches, exact details", () => {
  it("down_id present -> run_down_migration targeting the down_id", () => {
    const out = plan({ migrations: [{ id: "m1", down_id: "m1-undo" }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "migration",
        action: "run_down_migration",
        target: "m1-undo",
        detail: "Run compensating migration m1-undo to undo m1",
        risk: "normal",
      },
    ]);
  });

  it("down_id takes precedence over reversible: false", () => {
    const out = plan({
      migrations: [{ id: "m1", reversible: false, down_id: "m1-undo" }],
    });
    assert.deepEqual(out.steps[0], {
      order: 1,
      kind: "migration",
      action: "run_down_migration",
      target: "m1-undo",
      detail: "Run compensating migration m1-undo to undo m1",
      risk: "normal",
    });
    assert.equal(out.safe, true);
    assert.equal(out.counts.blocked, 0);
  });

  it("down_id takes precedence over reversible: true", () => {
    const out = plan({
      migrations: [{ id: "m1", reversible: true, down_id: "m1-fix" }],
    });
    assert.equal(out.steps[0].target, "m1-fix");
    assert.equal(out.steps[0].detail, "Run compensating migration m1-fix to undo m1");
  });

  it("reversible true without down_id -> run_down_migration targeting the id", () => {
    const out = plan({ migrations: [{ id: "m2", reversible: true }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "migration",
        action: "run_down_migration",
        target: "m2",
        detail: "Run the down migration for m2",
        risk: "normal",
      },
    ]);
  });

  it("reversible omitted defaults to true", () => {
    const out = plan({ migrations: [{ id: "m2" }] });
    assert.equal(out.steps[0].action, "run_down_migration");
    assert.equal(out.steps[0].target, "m2");
    assert.equal(out.steps[0].detail, "Run the down migration for m2");
  });

  it("irreversible without down_id -> manual action, blocked risk", () => {
    const out = plan({ migrations: [{ id: "m3", reversible: false }] });
    assert.deepEqual(out.steps, [
      {
        order: 1,
        kind: "migration",
        action: "manual",
        target: "m3",
        detail:
          "Migration m3 is irreversible and has no compensating migration; manual data recovery is required",
        risk: "blocked",
      },
    ]);
  });
});

describe("planRollback — pinned ordering", () => {
  it("flags first, then env, then migrations reversed — with 1-based orders", () => {
    const out = plan({
      migrations: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      env_changes: [
        { name: "A_KEY", action: "added" },
        { name: "B_KEY", action: "added" },
      ],
      feature_flags: [
        { name: "flag-one", change: "enabled" },
        { name: "flag-two", change: "disabled" },
      ],
    });
    assert.deepEqual(
      out.steps.map((s) => [s.order, s.kind, s.target]),
      [
        [1, "feature_flag", "flag-one"],
        [2, "feature_flag", "flag-two"],
        [3, "env", "A_KEY"],
        [4, "env", "B_KEY"],
        [5, "migration", "m3"],
        [6, "migration", "m2"],
        [7, "migration", "m1"],
      ],
    );
  });

  it("flag steps keep input order (not sorted)", () => {
    const out = plan({
      feature_flags: [
        { name: "zeta", change: "enabled" },
        { name: "alpha", change: "enabled" },
      ],
    });
    assert.deepEqual(out.steps.map((s) => s.target), ["zeta", "alpha"]);
  });

  it("env steps keep input order (not sorted)", () => {
    const out = plan({
      env_changes: [
        { name: "Z_KEY", action: "added" },
        { name: "A_KEY", action: "added" },
      ],
    });
    assert.deepEqual(out.steps.map((s) => s.target), ["Z_KEY", "A_KEY"]);
  });

  it("migration steps are in exact reverse input order: last applied, first rolled back", () => {
    const out = plan({
      migrations: [{ id: "first" }, { id: "second" }, { id: "third" }, { id: "fourth" }],
    });
    assert.deepEqual(out.steps.map((s) => s.target), ["fourth", "third", "second", "first"]);
    assert.deepEqual(out.steps.map((s) => s.order), [1, 2, 3, 4]);
  });

  it("the full result object matches exactly for a mixed release", () => {
    const out = planRollback({
      release: "2026.10.27",
      feature_flags: [{ name: "checkout-v2", change: "enabled" }],
      env_changes: [{ name: "TIMEOUT_MS", action: "changed", previous_value_known: true }],
      migrations: [{ id: "add_orders" }, { id: "drop_legacy", reversible: false }],
    });
    assert.deepEqual(out, {
      release: "2026.10.27",
      steps: [
        {
          order: 1,
          kind: "feature_flag",
          action: "disable",
          target: "checkout-v2",
          detail: "Disable feature flag checkout-v2 (enabled by this release)",
          risk: "normal",
        },
        {
          order: 2,
          kind: "env",
          action: "set",
          target: "TIMEOUT_MS",
          detail: "Restore environment variable TIMEOUT_MS to its recorded pre-release value",
          risk: "normal",
        },
        {
          order: 3,
          kind: "migration",
          action: "manual",
          target: "drop_legacy",
          detail:
            "Migration drop_legacy is irreversible and has no compensating migration; manual data recovery is required",
          risk: "blocked",
        },
        {
          order: 4,
          kind: "migration",
          action: "run_down_migration",
          target: "add_orders",
          detail: "Run the down migration for add_orders",
          risk: "normal",
        },
      ],
      counts: { steps: 4, feature_flags: 1, env_changes: 1, migrations: 2, manual: 0, blocked: 1 },
      safe: false,
    });
  });
});

describe("planRollback — counts, safe, and the empty case", () => {
  it("all three lists empty: steps is [] and safe is true", () => {
    const out = plan({ migrations: [], env_changes: [], feature_flags: [] });
    assert.deepEqual(out, {
      release: "v2.4.0",
      steps: [],
      counts: { steps: 0, feature_flags: 0, env_changes: 0, migrations: 0, manual: 0, blocked: 0 },
      safe: true,
    });
  });

  it("all three lists omitted behave like empty lists", () => {
    const out = plan();
    assert.deepEqual(out.steps, []);
    assert.equal(out.safe, true);
    assert.deepEqual(out.counts, {
      steps: 0,
      feature_flags: 0,
      env_changes: 0,
      migrations: 0,
      manual: 0,
      blocked: 0,
    });
  });

  it("manual counts steps by risk across kinds; blocked counts blocked steps only", () => {
    const out = plan({
      feature_flags: [{ name: "gone-flag", change: "removed" }],
      env_changes: [
        { name: "LOST", action: "removed" },
        { name: "FINE", action: "added" },
      ],
      migrations: [{ id: "bad", reversible: false }, { id: "ok" }],
    });
    assert.deepEqual(out.counts, {
      steps: 5,
      feature_flags: 1,
      env_changes: 2,
      migrations: 2,
      manual: 2,
      blocked: 1,
    });
    assert.equal(out.safe, false);
  });

  it("a blocked step's action is 'manual' but it is not counted as manual risk", () => {
    const out = plan({ migrations: [{ id: "bad", reversible: false }] });
    assert.equal(out.steps[0].action, "manual");
    assert.equal(out.steps[0].risk, "blocked");
    assert.equal(out.counts.manual, 0);
    assert.equal(out.counts.blocked, 1);
  });

  it("safe is true when there are manual steps but no blocked steps", () => {
    const out = plan({ feature_flags: [{ name: "gone", change: "removed" }] });
    assert.equal(out.counts.manual, 1);
    assert.equal(out.counts.blocked, 0);
    assert.equal(out.safe, true);
  });

  it("safe is false exactly when blocked is non-zero", () => {
    const out = plan({
      migrations: [{ id: "a", reversible: false }, { id: "b", reversible: false }],
    });
    assert.equal(out.counts.blocked, 2);
    assert.equal(out.safe, false);
  });

  it("counts.steps equals the number of steps and the per-kind counts sum to it", () => {
    const out = plan({
      feature_flags: [{ name: "f", change: "added" }],
      env_changes: [{ name: "E", action: "added" }],
      migrations: [{ id: "m" }],
    });
    assert.equal(out.counts.steps, out.steps.length);
    assert.equal(
      out.counts.feature_flags + out.counts.env_changes + out.counts.migrations,
      out.counts.steps,
    );
  });

  it("the release string is echoed verbatim", () => {
    assert.equal(planRollback({ release: "release-2026-10-27-hotfix" }).release, "release-2026-10-27-hotfix");
  });

  it("unknown extra fields are ignored (pinned judgement call)", () => {
    const out = planRollback({
      release: "v1",
      migrations: [{ id: "m", note: "extra" }],
      comment: "not part of the spec",
    });
    assert.equal(out.steps[0].detail, "Run the down migration for m");
  });
});

describe("planRollback — validation", () => {
  const throws = (args: unknown, message: string) =>
    assert.throws(() => planRollback(args), { message });

  it("release missing names release", () => {
    throws({}, "release is required");
    throws(null, "release is required");
    throws([], "release is required");
  });

  it("release empty or non-string names release", () => {
    throws({ release: "" }, "release must be a non-empty string");
    throws({ release: 42 }, "release must be a non-empty string");
    throws({ release: null }, "release must be a non-empty string");
  });

  it("a list present but not an array names the list", () => {
    throws({ release: "v1", migrations: "m1" }, "migrations must be an array");
    throws({ release: "v1", env_changes: {} }, "env_changes must be an array");
    throws({ release: "v1", feature_flags: 7 }, "feature_flags must be an array");
  });

  it("an entry that is not an object names its path", () => {
    throws({ release: "v1", migrations: ["m1"] }, "migrations[0] must be an object");
    throws({ release: "v1", env_changes: [null] }, "env_changes[0] must be an object");
    throws(
      { release: "v1", feature_flags: [{ name: "ok", change: "added" }, "x"] },
      "feature_flags[1] must be an object",
    );
  });

  it("migration id missing, empty, or non-string names its path", () => {
    throws({ release: "v1", migrations: [{}] }, "migrations[0].id is required");
    throws({ release: "v1", migrations: [{ id: "" }] }, "migrations[0].id must be a non-empty string");
    throws({ release: "v1", migrations: [{ id: 3 }] }, "migrations[0].id must be a non-empty string");
  });

  it("a duplicate migration id names the second occurrence's path", () => {
    throws(
      { release: "v1", migrations: [{ id: "dup" }, { id: "other" }, { id: "dup" }] },
      'migrations[2].id duplicates migrations[0].id "dup"',
    );
  });

  it("env name missing, empty, or non-string names its path", () => {
    throws({ release: "v1", env_changes: [{ action: "added" }] }, "env_changes[0].name is required");
    throws(
      { release: "v1", env_changes: [{ name: "", action: "added" }] },
      "env_changes[0].name must be a non-empty string",
    );
    throws(
      { release: "v1", env_changes: [{ name: 9, action: "added" }] },
      "env_changes[0].name must be a non-empty string",
    );
  });

  it("a duplicate env name names the second occurrence's path", () => {
    throws(
      {
        release: "v1",
        env_changes: [
          { name: "KEY", action: "added" },
          { name: "KEY", action: "removed" },
        ],
      },
      'env_changes[1].name duplicates env_changes[0].name "KEY"',
    );
  });

  it("flag name missing, empty, or non-string names its path", () => {
    throws({ release: "v1", feature_flags: [{ change: "added" }] }, "feature_flags[0].name is required");
    throws(
      { release: "v1", feature_flags: [{ name: "", change: "added" }] },
      "feature_flags[0].name must be a non-empty string",
    );
    throws(
      { release: "v1", feature_flags: [{ name: false, change: "added" }] },
      "feature_flags[0].name must be a non-empty string",
    );
  });

  it("a duplicate flag name names the second occurrence's path", () => {
    throws(
      {
        release: "v1",
        feature_flags: [
          { name: "f", change: "enabled" },
          { name: "f", change: "disabled" },
        ],
      },
      'feature_flags[1].name duplicates feature_flags[0].name "f"',
    );
  });

  it("the same name in different lists is not a duplicate", () => {
    const out = planRollback({
      release: "v1",
      migrations: [{ id: "shared" }],
      env_changes: [{ name: "shared", action: "added" }],
      feature_flags: [{ name: "shared", change: "added" }],
    });
    assert.equal(out.counts.steps, 3);
  });

  it("env action missing names its path", () => {
    throws({ release: "v1", env_changes: [{ name: "K" }] }, "env_changes[0].action is required");
  });

  it("env action outside its enum names its path", () => {
    throws(
      { release: "v1", env_changes: [{ name: "K", action: "renamed" }] },
      "env_changes[0].action must be one of: added, changed, removed",
    );
    throws(
      { release: "v1", env_changes: [{ name: "K", action: 1 }] },
      "env_changes[0].action must be one of: added, changed, removed",
    );
  });

  it("flag change missing names its path", () => {
    throws({ release: "v1", feature_flags: [{ name: "f" }] }, "feature_flags[0].change is required");
  });

  it("flag change outside its enum names its path", () => {
    throws(
      { release: "v1", feature_flags: [{ name: "f", change: "toggled" }] },
      "feature_flags[0].change must be one of: enabled, disabled, added, removed",
    );
    throws(
      { release: "v1", feature_flags: [{ name: "f", change: null }] },
      "feature_flags[0].change must be one of: enabled, disabled, added, removed",
    );
  });

  it("non-boolean reversible names its exact path", () => {
    throws(
      { release: "v1", migrations: [{ id: "m", reversible: "yes" }] },
      "migrations[0].reversible must be a boolean",
    );
    throws(
      { release: "v1", migrations: [{ id: "a" }, { id: "b", reversible: null }] },
      "migrations[1].reversible must be a boolean",
    );
  });

  it("non-boolean previous_value_known names its exact path", () => {
    throws(
      { release: "v1", env_changes: [{ name: "K", action: "changed", previous_value_known: 1 }] },
      "env_changes[0].previous_value_known must be a boolean",
    );
  });

  it("down_id present but empty or non-string names its path", () => {
    throws(
      { release: "v1", migrations: [{ id: "m", down_id: "" }] },
      "migrations[0].down_id must be a non-empty string",
    );
    throws(
      { release: "v1", migrations: [{ id: "m", down_id: 12 }] },
      "migrations[0].down_id must be a non-empty string",
    );
  });

  it("no partial result is produced on invalid input", () => {
    assert.throws(() =>
      planRollback({
        release: "v1",
        feature_flags: [{ name: "fine", change: "enabled" }],
        migrations: [{ id: "dup" }, { id: "dup" }],
      }),
    );
  });
});
