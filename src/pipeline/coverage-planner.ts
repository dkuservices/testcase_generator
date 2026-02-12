/**
 * Coverage Planner
 * Plans test coverage for detected modules to ensure comprehensive testing
 */

import { DocumentPage, CoveragePlan, ModuleCoveragePlan } from '../models/word-document';
import { createContextLogger } from '../utils/logger';

interface CoveragePlannerConfig {
  minTestsPerChangeRequest: number;
  maxTestsPerModule: number;
  happyPathRatio: number;
  negativeRatio: number;
  edgeCaseRatio: number;
}

const DEFAULT_CONFIG: CoveragePlannerConfig = {
  minTestsPerChangeRequest: 3,  // At least 3 tests per change request
  maxTestsPerModule: 30,         // Cap per module to avoid excessive tests
  happyPathRatio: 0.4,           // 40% happy path tests
  negativeRatio: 0.35,           // 35% negative tests
  edgeCaseRatio: 0.25,           // 25% edge case tests
};

/**
 * Create a coverage plan for detected modules
 */
export function planCoverage(
  pages: DocumentPage[],
  documentId: string,
  config: Partial<CoveragePlannerConfig> = {}
): CoveragePlan {
  const contextLogger = createContextLogger({
    step: 'coverage_planning',
    document_id: documentId,
  });

  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  contextLogger.info('Planning test coverage', {
    pages_count: pages.length,
    config: finalConfig,
  });

  const modulePlans: ModuleCoveragePlan[] = pages.map(page =>
    planModuleCoverage(page, finalConfig, contextLogger)
  );

  const totalTestsPlanned = modulePlans.reduce((sum, mp) => sum + mp.tests_planned, 0);

  const plan: CoveragePlan = {
    document_id: documentId,
    total_tests_planned: totalTestsPlanned,
    modules: modulePlans,
    created_at: new Date().toISOString(),
  };

  contextLogger.info('Coverage plan created', {
    total_tests_planned: totalTestsPlanned,
    modules_planned: modulePlans.length,
    breakdown: modulePlans.map(mp => ({
      module: mp.module_name,
      tests: mp.tests_planned,
    })),
  });

  return plan;
}

function planModuleCoverage(
  module: DocumentPage,
  config: CoveragePlannerConfig,
  logger: ReturnType<typeof createContextLogger>
): ModuleCoveragePlan {
  const changeRequestCount = module.change_requests.length;

  // Base calculation: minimum tests per change request
  let testsPlanned = Math.max(
    changeRequestCount * config.minTestsPerChangeRequest,
    config.minTestsPerChangeRequest
  );

  // Apply priority multiplier
  const priorityMultipliers = {
    critical: 1.5,
    high: 1.2,
    medium: 1.0,
    low: 0.7,
  };

  testsPlanned = Math.ceil(testsPlanned * priorityMultipliers[module.priority]);

  // Cap at max
  testsPlanned = Math.min(testsPlanned, config.maxTestsPerModule);

  // Distribute tests by type (use floor to avoid negative edge case)
  const happyPath = Math.floor(testsPlanned * config.happyPathRatio);
  const negative = Math.floor(testsPlanned * config.negativeRatio);
  const edgeCase = testsPlanned - happyPath - negative;

  logger.info('Module coverage planned', {
    module: module.name,
    change_requests: changeRequestCount,
    tests_planned: testsPlanned,
    distribution: { happyPath, negative, edgeCase },
  });

  return {
    module_id: module.module_id,
    module_name: module.name,
    tests_planned: testsPlanned,
    test_distribution: {
      happy_path: happyPath,
      negative: negative,
      edge_case: edgeCase,
    },
    change_requests_covered: module.change_requests.map(cr => cr.id),
  };
}

/**
 * Generate a summary of the coverage plan
 */
export function getCoverageSummary(plan: CoveragePlan): string {
  const lines: string[] = [
    `Coverage Plan for Document: ${plan.document_id}`,
    `Created: ${plan.created_at}`,
    ``,
    `Total Tests Planned: ${plan.total_tests_planned}`,
    `Modules: ${plan.modules.length}`,
    ``,
    `Module Breakdown:`,
  ];

  for (const modulePlan of plan.modules) {
    lines.push(`  - ${modulePlan.module_name}`);
    lines.push(`    Tests: ${modulePlan.tests_planned} (Happy: ${modulePlan.test_distribution.happy_path}, Negative: ${modulePlan.test_distribution.negative}, Edge: ${modulePlan.test_distribution.edge_case})`);
    lines.push(`    Change Requests Covered: ${modulePlan.change_requests_covered.length}`);
  }

  return lines.join('\n');
}

/**
 * Estimate total coverage metrics
 */
export function estimateCoverageMetrics(
  pages: DocumentPage[],
  plan: CoveragePlan
): {
  totalChangeRequests: number;
  totalAcceptanceCriteria: number;
  testsPerChangeRequest: number;
  testsPerCriterion: number;
} {
  const totalChangeRequests = pages.reduce(
    (sum, m) => sum + m.change_requests.length,
    0
  );

  const totalAcceptanceCriteria = pages.reduce(
    (sum, m) => sum + m.change_requests.reduce(
      (crSum, cr) => crSum + cr.acceptance_criteria.length,
      0
    ),
    0
  );

  return {
    totalChangeRequests,
    totalAcceptanceCriteria,
    testsPerChangeRequest: totalChangeRequests > 0
      ? Math.round((plan.total_tests_planned / totalChangeRequests) * 10) / 10
      : 0,
    testsPerCriterion: totalAcceptanceCriteria > 0
      ? Math.round((plan.total_tests_planned / totalAcceptanceCriteria) * 10) / 10
      : 0,
  };
}
