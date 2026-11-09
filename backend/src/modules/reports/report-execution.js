import {
  ELIGIBILITY_RULES_VERSION,
  assertEligibilityProductionReady,
  getEligibilityReadiness,
} from '../gaap/index.js';
import { ABORT_REASONS, createReportGenerator } from './report-generation.js';
import { createReportRunner } from './report-runner.js';
import { ReportRejectedError } from './reports.service.js';

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  maxConcurrent: 1,
  maxQueued: 5,
  // GAAP /sales pages took ~35 s each when probed (Feature 14), so a large report needs minutes.
  timeoutMs: 20 * 60 * 1000,
});

const ENV = Object.freeze({
  maxConcurrent: { name: 'REPORT_MAX_CONCURRENT_RUNS', min: 1, max: 10 },
  maxQueued: { name: 'REPORT_MAX_QUEUED_RUNS', min: 0, max: 100 },
  timeoutMs: { name: 'REPORT_RUN_TIMEOUT_MS', min: 1000, max: 6 * 60 * 60 * 1000 },
});

/**
 * Execution settings from the environment. Invalid values abort startup, naming the variable only.
 * `requireVerifiedRules` (REPORT_REQUIRE_VERIFIED_RULES, default true) keeps the Feature 17 block
 * in force; setting it to `false` is an explicit override and every report then records
 * `+unverified-rules` in its calculation version.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadReportExecutionConfig(env = process.env) {
  const config = { ...DEFAULT_EXECUTION_LIMITS, requireVerifiedRules: true };
  const errors = [];
  for (const [key, { name, min, max }] of Object.entries(ENV)) {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!/^\d{1,10}$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      errors.push(`${name} must be a whole number from ${min} to ${max}`);
    } else {
      config[key] = value;
    }
  }
  const flag = env.REPORT_REQUIRE_VERIFIED_RULES?.trim().toLowerCase();
  if (flag !== undefined && flag !== '') {
    if (flag === 'true') config.requireVerifiedRules = true;
    else if (flag === 'false') config.requireVerifiedRules = false;
    else errors.push('REPORT_REQUIRE_VERIFIED_RULES must be true or false');
  }
  if (errors.length > 0)
    throw new Error(`Invalid report execution settings:\n- ${errors.join('\n- ')}`);
  return Object.freeze(config);
}

/**
 * Wires generation to a bounded runner and exposes the `startReport` hook of the reports service.
 *
 * `startReport` refuses (no report created) when the rules are unverified and enforcement is on, or
 * when the runner is full; otherwise it creates the `pending` report, queues the job and returns at
 * once. A failed report is never reopened: generating again creates a new report.
 *
 * @param {object} deps
 * @param {import('./report-generation.js').ReportRepository} deps.repository
 * @param {{ fetchSales: Function }} deps.salesAdapter
 * @param {{ enabled: boolean }} deps.salesCachePolicy
 * @param {ReturnType<typeof loadReportExecutionConfig>} [deps.config]
 * @param {'base' | 'unknown'} [deps.differingCurrencyPolicy]
 * @param {() => Date} [deps.now]
 */
export function createReportExecution({
  repository,
  salesAdapter,
  salesCachePolicy,
  config = loadReportExecutionConfig({}),
  differingCurrencyPolicy,
  now = () => new Date(),
}) {
  const runner = createReportRunner(config);
  const readiness = getEligibilityReadiness();
  const generator = createReportGenerator({
    salesAdapter,
    repository,
    salesCachePolicy,
    rulesVerified: readiness.productionReady,
    differingCurrencyPolicy,
    now,
  });

  function assertRulesAllowed() {
    if (!config.requireVerifiedRules) return;
    try {
      assertEligibilityProductionReady();
    } catch (error) {
      if (error?.code !== 'ELIGIBILITY_RULES_UNVERIFIED') throw error;
      throw new ReportRejectedError(
        'ELIGIBILITY_RULES_UNVERIFIED',
        'Reports cannot be generated until the owner confirms the transaction eligibility rules.',
        {
          rulesVersion: ELIGIBILITY_RULES_VERSION,
          unverifiedRuleCount: readiness.unverifiedRules.length,
        },
      );
    }
  }

  /** Live jobs by report id, so a cancel can reach the one that is running or queued. */
  const active = new Map();

  async function startReport({ request, requestId }) {
    assertRulesAllowed();
    const slot = runner.reserve(); // throws ReportBusyError before anything is created
    let created;
    try {
      created = await repository.createPending({ request, startedAt: now() });
    } catch (error) {
      slot.release();
      throw error;
    }
    const cancelController = new AbortController();
    active.set(created.reportId, cancelController);
    slot.run(async (signal) => {
      try {
        return await generator.generate({
          reportId: created.reportId,
          request,
          requestId,
          signal: AbortSignal.any([signal, cancelController.signal]),
        });
      } finally {
        active.delete(created.reportId);
      }
    });
    return { reportId: created.reportId, status: 'pending' };
  }

  /**
   * Cancels a pending report: stops its job and removes the report, so nothing is saved. A report
   * that already finished (completed or failed) is left alone.
   * @returns {Promise<{ found: boolean, cancelled: boolean, status?: string }>}
   */
  async function cancelReport(reportId) {
    const current = await repository.getStatus(reportId);
    if (current === null || current === undefined) return { found: false, cancelled: false };
    if (current.status !== 'pending') {
      return { found: true, cancelled: false, status: current.status };
    }
    active.get(reportId)?.abort(ABORT_REASONS.CANCELLED);
    await repository.discardPending({ reportId });
    return { found: true, cancelled: true };
  }

  return Object.freeze({
    startReport,
    cancelReport,
    getStatus: (reportId) => repository.getStatus(reportId),
    /** Resolves when no report is running or queued (tests, orderly shutdown). */
    idle: runner.idle,
    stats: runner.stats,
    /** Aborts running reports (recorded as failed/interrupted) and stops accepting new ones. */
    stop: runner.stop,
  });
}
