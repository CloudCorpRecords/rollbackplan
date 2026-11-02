/**
 * rollbackplan core: release rollback plan from a diff.
 *
 *   planRollback(args) -> plan
 *
 * Steps are built in one pinned order: all feature-flag
 * steps in input order, then all env steps in input order,
 * then all migration steps in REVERSE input order — the
 * last migration applied is the first rolled back. Each
 * step is {order (1-based), kind, action, target, detail,
 * risk}; risk is "normal" unless a rule below sets it.
 *
 * Feature flags (kind "feature_flag", target = flag name):
 *   enabled  -> disable, normal
 *   disabled -> enable, normal
 *   added    -> remove, normal
 *   removed  -> restore, manual (recreate pre-release state)
 *
 * Env changes (kind "env", target = variable name):
 *   added                     -> unset, normal
 *   removed, value known      -> set, normal
 *   removed, value unknown    -> restore, manual
 *   changed, value known      -> set, normal
 *   changed, value unknown    -> restore, manual
 *
 * Migrations (kind "migration", reverse input order):
 *   down_id present  -> run_down_migration, target = down_id
 *   reversible true  -> run_down_migration, target = id
 *   otherwise        -> manual, blocked (target = id)
 *
 * A present down_id takes precedence over reversible,
 * including over reversible: false. The result is
 * {release, steps, counts, safe}: counts totals the steps
 * overall and per kind, and counts manual / blocked steps
 * by risk; safe is true exactly when blocked is 0. All
 * three input lists may be empty, in which case steps is
 * [] and safe is true.
 *
 * Defaults: migrations / env_changes / feature_flags
 * default to [], reversible defaults to true per migration,
 * and previous_value_known defaults to false per env change.
 *
 * Validation is strict and path-naming: any malformed input
 * throws an Error naming the offending path (for example
 * "migrations[1].id duplicates migrations[0].id \"m2\"") and
 * no partial result is produced. This module plans only:
 * it executes nothing.
 */
import type {
  EnvAction,
  FlagChange,
  RollbackEnvChange,
  RollbackFeatureFlag,
  RollbackMigration,
  RollbackPlanResult,
  RollbackStep,
} from "./types.js";

export const VERSION = "0.1.0";

const ENV_ACTIONS: readonly string[] = ["added", "changed", "removed"];
const FLAG_CHANGES: readonly string[] = ["enabled", "disabled", "added", "removed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalList(raw: Record<string, unknown>, key: string): unknown[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value;
}

function requiredName(
  entry: Record<string, unknown>,
  key: "id" | "name",
  path: string,
): string {
  const value = entry[key];
  if (value === undefined) throw new Error(`${path}.${key} is required`);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function checkDuplicate(
  seen: Map<string, number>,
  value: string,
  key: "id" | "name",
  list: string,
  index: number,
  path: string,
): void {
  const first = seen.get(value);
  if (first !== undefined) {
    throw new Error(
      `${path}.${key} duplicates ${list}[${first}].${key} "${value}"`,
    );
  }
  seen.set(value, index);
}

function optionalBoolean(
  entry: Record<string, unknown>,
  key: "reversible" | "previous_value_known",
  fallback: boolean,
  path: string,
): boolean {
  const value = entry[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return value;
}

function validateArgs(args: unknown): {
  release: string;
  migrations: RollbackMigration[];
  envChanges: RollbackEnvChange[];
  featureFlags: RollbackFeatureFlag[];
} {
  const raw: Record<string, unknown> = isRecord(args) ? args : {};

  if (raw.release === undefined) throw new Error("release is required");
  if (typeof raw.release !== "string" || raw.release.length === 0) {
    throw new Error("release must be a non-empty string");
  }
  const release = raw.release;

  const migrations: RollbackMigration[] = [];
  const migrationIds = new Map<string, number>();
  optionalList(raw, "migrations").forEach((entry, i) => {
    const path = `migrations[${i}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    const id = requiredName(entry, "id", path);
    checkDuplicate(migrationIds, id, "id", "migrations", i, path);
    const reversible = optionalBoolean(entry, "reversible", true, path);
    let downId: string | undefined;
    if (entry.down_id !== undefined) {
      if (typeof entry.down_id !== "string" || entry.down_id.length === 0) {
        throw new Error(`${path}.down_id must be a non-empty string`);
      }
      downId = entry.down_id;
    }
    const migration: RollbackMigration = { id, reversible };
    if (downId !== undefined) migration.down_id = downId;
    migrations.push(migration);
  });

  const envChanges: RollbackEnvChange[] = [];
  const envNames = new Map<string, number>();
  optionalList(raw, "env_changes").forEach((entry, i) => {
    const path = `env_changes[${i}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    const name = requiredName(entry, "name", path);
    checkDuplicate(envNames, name, "name", "env_changes", i, path);
    if (entry.action === undefined) throw new Error(`${path}.action is required`);
    if (typeof entry.action !== "string" || !ENV_ACTIONS.includes(entry.action)) {
      throw new Error(`${path}.action must be one of: added, changed, removed`);
    }
    envChanges.push({
      name,
      action: entry.action as EnvAction,
      previous_value_known: optionalBoolean(
        entry,
        "previous_value_known",
        false,
        path,
      ),
    });
  });

  const featureFlags: RollbackFeatureFlag[] = [];
  const flagNames = new Map<string, number>();
  optionalList(raw, "feature_flags").forEach((entry, i) => {
    const path = `feature_flags[${i}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    const name = requiredName(entry, "name", path);
    checkDuplicate(flagNames, name, "name", "feature_flags", i, path);
    if (entry.change === undefined) throw new Error(`${path}.change is required`);
    if (typeof entry.change !== "string" || !FLAG_CHANGES.includes(entry.change)) {
      throw new Error(
        `${path}.change must be one of: enabled, disabled, added, removed`,
      );
    }
    featureFlags.push({ name, change: entry.change as FlagChange });
  });

  return { release, migrations, envChanges, featureFlags };
}

type StepDraft = Omit<RollbackStep, "order">;

function flagStep(flag: RollbackFeatureFlag): StepDraft {
  const { name } = flag;
  switch (flag.change) {
    case "enabled":
      return {
        kind: "feature_flag",
        action: "disable",
        target: name,
        detail: `Disable feature flag ${name} (enabled by this release)`,
        risk: "normal",
      };
    case "disabled":
      return {
        kind: "feature_flag",
        action: "enable",
        target: name,
        detail: `Re-enable feature flag ${name} (disabled by this release)`,
        risk: "normal",
      };
    case "added":
      return {
        kind: "feature_flag",
        action: "remove",
        target: name,
        detail: `Remove feature flag ${name} (added by this release)`,
        risk: "normal",
      };
    case "removed":
      return {
        kind: "feature_flag",
        action: "restore",
        target: name,
        detail: `Feature flag ${name} was removed by this release; recreate it in its pre-release state`,
        risk: "manual",
      };
  }
}

function envStep(change: RollbackEnvChange): StepDraft {
  const { name } = change;
  switch (change.action) {
    case "added":
      return {
        kind: "env",
        action: "unset",
        target: name,
        detail: `Remove environment variable ${name} (added by this release)`,
        risk: "normal",
      };
    case "removed":
      if (change.previous_value_known) {
        return {
          kind: "env",
          action: "set",
          target: name,
          detail: `Restore environment variable ${name} to its recorded pre-release value`,
          risk: "normal",
        };
      }
      return {
        kind: "env",
        action: "restore",
        target: name,
        detail: `Environment variable ${name} was removed by this release and its pre-release value is not recorded; restore it manually`,
        risk: "manual",
      };
    case "changed":
      if (change.previous_value_known) {
        return {
          kind: "env",
          action: "set",
          target: name,
          detail: `Restore environment variable ${name} to its recorded pre-release value`,
          risk: "normal",
        };
      }
      return {
        kind: "env",
        action: "restore",
        target: name,
        detail: `Environment variable ${name} was changed by this release and its pre-release value is not recorded; restore it manually`,
        risk: "manual",
      };
  }
}

function migrationStep(migration: RollbackMigration): StepDraft {
  const { id } = migration;
  if (migration.down_id !== undefined) {
    return {
      kind: "migration",
      action: "run_down_migration",
      target: migration.down_id,
      detail: `Run compensating migration ${migration.down_id} to undo ${id}`,
      risk: "normal",
    };
  }
  if (migration.reversible) {
    return {
      kind: "migration",
      action: "run_down_migration",
      target: id,
      detail: `Run the down migration for ${id}`,
      risk: "normal",
    };
  }
  return {
    kind: "migration",
    action: "manual",
    target: id,
    detail: `Migration ${id} is irreversible and has no compensating migration; manual data recovery is required`,
    risk: "blocked",
  };
}

/** Plan the rollback of the supplied release. */
export function planRollback(args: unknown): RollbackPlanResult {
  const { release, migrations, envChanges, featureFlags } = validateArgs(args);

  const drafts: StepDraft[] = [
    ...featureFlags.map(flagStep),
    ...envChanges.map(envStep),
    ...[...migrations].reverse().map(migrationStep),
  ];
  const steps: RollbackStep[] = drafts.map((draft, i) => ({
    order: i + 1,
    ...draft,
  }));

  const counts = {
    steps: steps.length,
    feature_flags: featureFlags.length,
    env_changes: envChanges.length,
    migrations: migrations.length,
    manual: steps.filter((s) => s.risk === "manual").length,
    blocked: steps.filter((s) => s.risk === "blocked").length,
  };

  return { release, steps, counts, safe: counts.blocked === 0 };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
