import { Router, Request, Response, NextFunction } from 'express';
import { collectExportData } from '../../export/export-data-collector';
import { generateExcelReport } from '../../export/excel-generator';
import { generatePdfReport } from '../../export/pdf-generator';
import { ExportOptions, ExportStatus, ExportScenarioEntry } from '../../export/export-types';
import { ApiError } from '../middleware/error-handler';
import logger from '../../utils/logger';

const router = Router();

const VALID_STATUSES: ExportStatus[] = ['validated', 'needs_review', 'dismissed'];

function parseExportOptions(req: Request): ExportOptions {
  const statusParam = (req.query.status as string) || '';
  const statuses = statusParam
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ExportStatus => VALID_STATUSES.includes(s as ExportStatus));

  if (statuses.length === 0) {
    throw new ApiError(
      'At least one valid status required: validated, needs_review, dismissed',
      400
    );
  }

  return {
    statuses,
    jobId: (req.query.jobId as string) || undefined,
  };
}

router.get('/excel', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const options = parseExportOptions(req);
    const scenarios = await collectExportData(options);

    logger.info('Excel export requested', {
      statuses: options.statuses,
      jobId: options.jobId,
      scenario_count: scenarios.length,
    });

    if (scenarios.length === 0) {
      throw new ApiError('No scenarios found matching the selected filters', 404);
    }

    const workbook = await generateExcelReport(scenarios);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `test-scenarios-${timestamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

router.get('/pdf', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const options = parseExportOptions(req);
    const scenarios = await collectExportData(options);

    logger.info('PDF export requested', {
      statuses: options.statuses,
      jobId: options.jobId,
      scenario_count: scenarios.length,
    });

    if (scenarios.length === 0) {
      throw new ApiError('No scenarios found matching the selected filters', 404);
    }

    const pdfBuffer = await generatePdfReport(scenarios);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `test-scenarios-${timestamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// POST endpoints accept scenarios directly in request body.
// Used by Page and Component pages that already have scenarios loaded client-side.
router.post('/excel', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { scenarios: rawScenarios, title } = req.body || {};

    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      throw new ApiError('Request body must contain a non-empty "scenarios" array', 400);
    }

    const scenarios: ExportScenarioEntry[] = rawScenarios.map((s: any) => ({
      job_id: s.job_id || '',
      job_created_at: s.job_created_at || new Date().toISOString(),
      source_title: s.source_title || title || '',
      scenario: s.scenario || s,
    }));

    logger.info('Excel export (POST) requested', { scenario_count: scenarios.length });

    const workbook = await generateExcelReport(scenarios);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `test-scenarios-${timestamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

router.post('/pdf', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { scenarios: rawScenarios, title } = req.body || {};

    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      throw new ApiError('Request body must contain a non-empty "scenarios" array', 400);
    }

    const scenarios: ExportScenarioEntry[] = rawScenarios.map((s: any) => ({
      job_id: s.job_id || '',
      job_created_at: s.job_created_at || new Date().toISOString(),
      source_title: s.source_title || title || '',
      scenario: s.scenario || s,
    }));

    logger.info('PDF export (POST) requested', { scenario_count: scenarios.length });

    const pdfBuffer = await generatePdfReport(scenarios);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `test-scenarios-${timestamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
