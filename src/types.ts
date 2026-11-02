/**
 * rollbackplan types.
 *
 * rollbackplan plans the rollback of a release from the
 * diff that release introduced: the feature flags it
 * touched, the environment variable changes it made, and
 * the database migrations it applied, in application order.
 * From that data alone, as pure local computation,
 * rollbackplan reports an ordered list of rollback steps:
 *
 *   - feature-flag steps first, in input order
 *   - then environment steps, in input order
 *   - then migration steps, in reverse input order (the
 *     last migration applied is the first rolled back)
 *
 * Each step carries a risk: "normal" for steps that can be
 * carried out mechanically, "manual" for steps a person
 * must reconstruct by hand (a removed flag, or a changed or
 * removed variable whose pre-release value is not recorded),
 * and "blocked" for irreversible migrations with no
 * compensating migration. A plan is advice, not action:
 * nothing here executes a step.
 */

/** One migration the release applied, in application order. */
export interface RollbackMigration {
  /** Migration identifier; unique across the set. */
  id: string;
  /**
   * True when the migration ships a down migration.
   * Defaults to true when omitted.
   */
  reversible: boolean;
  /** Identifier of a compensating migration, when present. */
  down_id?: string;
}

/** What the release did to an environment variable. */
export type EnvAction = "added" | "changed" | "removed";

/** One environment variable change the release made. */
export interface RollbackEnvChange {
  /** Environment variable name; unique across the set. */
  name: string;
  /** What the release did to the variable. */
  action: EnvAction;
  /**
   * True when the pre-release value is recorded.
   * Defaults to false when omitted.
   */
  previous_value_known: boolean;
}

/** What the release did to a feature flag. */
export type FlagChange = "enabled" | "disabled" | "added" | "removed";

/** One feature flag change the release made. */
export interface RollbackFeatureFlag {
  /** Feature flag name; unique across the set. */
  name: string;
  /** What the release did to the flag. */
  change: FlagChange;
}

/** The kind of a rollback step. */
export type RollbackStepKind = "feature_flag" | "env" | "migration";

/** The risk attached to a rollback step. */
export type RollbackRisk = "normal" | "manual" | "blocked";

/** One ordered rollback step. */
export interface RollbackStep {
  /** 1-based position of this step in the plan. */
  order: number;
  /** Which part of the release diff this step undoes. */
  kind: RollbackStepKind;
  /** The rollback action to carry out. */
  action: string;
  /** The flag, variable, or migration this step acts on. */
  target: string;
  /** The exact human-readable instruction for this step. */
  detail: string;
  /** "normal", "manual", or "blocked". */
  risk: RollbackRisk;
}

/** Step totals for a rollback plan. */
export interface RollbackCounts {
  /** Total number of steps. */
  steps: number;
  /** Number of feature-flag steps. */
  feature_flags: number;
  /** Number of environment steps. */
  env_changes: number;
  /** Number of migration steps. */
  migrations: number;
  /** Number of steps whose risk is "manual". */
  manual: number;
  /** Number of steps whose risk is "blocked". */
  blocked: number;
}

/** The rollback plan. */
export interface RollbackPlanResult {
  /** Release identifier or version being rolled back. */
  release: string;
  /** Steps in pinned order: flags, then env, then migrations reversed. */
  steps: RollbackStep[];
  /** Step totals, with manual / blocked counted by risk. */
  counts: RollbackCounts;
  /** True exactly when no step is blocked. */
  safe: boolean;
}
