import { useEnvironmentStore } from '@/stores/environmentStore';
import type { TestCase, TestExecutionResult, TestStep } from '@/types';

// Shared QA helpers for {{var}} handling and runs.

/**
 * Variables earlier steps extract — the runner adds them to the variable map
 * as it goes, so a step can use `{{token}}` that step 2 extracted although no
 * environment defines it. Feeds RuntimeVarsProvider so those tokens aren't
 * flagged "missing" and are offered in the `{{` list.
 */
export function runtimeVarsBefore(steps: TestStep[], index: number): string[] {
  const out = new Set<string>();
  for (const s of steps.slice(0, Math.max(0, index))) {
    for (const ex of s.extractions ?? []) {
      const name = ex.variable?.trim();
      if (name) out.add(name);
    }
  }
  return Array.from(out);
}

/**
 * The environment a test run substitutes `{{vars}}` from: the active one — the
 * same env the step editors' `{{var}}` autocomplete and highlight read. Without
 * it the BE would send `{{base_url}}` literally.
 */
export function activeRunEnv(): { environmentId: string } | undefined {
  const id = useEnvironmentStore.getState().activeEnvironment?.id;
  return id ? { environmentId: id } : undefined;
}

const EXECUTABLE = new Set(['request', 'assertion', 'extract', 'wait']);

/** Mirrors the BE's hasExecutableSteps: a case with only manual steps has nothing to run. */
export function isExecutableCase(tc: Pick<TestCase, 'steps'>): boolean {
  return Array.isArray(tc.steps) && tc.steps.some((s) => EXECUTABLE.has(s?.type));
}

/**
 * The result shown when a run request itself fails (network, 404 "Environment
 * not found" / "Test case not found", …): an error step carrying the backend's
 * message, so the user sees why instead of an empty red result.
 */
export function runErrorResult(err: unknown): TestExecutionResult {
  const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
    ?? (err as { message?: string })?.message;
  return {
    status: 'error',
    duration: 0,
    steps: msg ? [{ stepNo: 0, type: 'request', status: 'error', duration: 0, error: msg }] : [],
    variables: {},
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
  };
}
