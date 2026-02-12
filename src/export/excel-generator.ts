import ExcelJS from 'exceljs';
import { ExportScenarioEntry, PRIORITY_COLORS, STATUS_COLORS } from './export-types';

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
}

function applyPriorityFill(cell: ExcelJS.Cell, priority: string): void {
  const colors = PRIORITY_COLORS[priority];
  if (colors) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colors.bg } };
    cell.font = { ...cell.font, color: { argb: 'FF' + colors.text } };
  }
}

function applyStatusFill(cell: ExcelJS.Cell, status: string): void {
  const colors = STATUS_COLORS[status];
  if (colors) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colors.bg } };
    cell.font = { ...cell.font, color: { argb: 'FF' + colors.text } };
  }
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEFE8DF' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 10,
  color: { argb: 'FF1F1B16' },
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD6CFC7' } },
  bottom: { style: 'thin', color: { argb: 'FFD6CFC7' } },
  left: { style: 'thin', color: { argb: 'FFD6CFC7' } },
  right: { style: 'thin', color: { argb: 'FFD6CFC7' } },
};

function groupByJob(entries: ExportScenarioEntry[]): Map<string, ExportScenarioEntry[]> {
  const groups = new Map<string, ExportScenarioEntry[]>();
  for (const entry of entries) {
    const key = entry.job_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
}

export async function generateExcelReport(scenarios: ExportScenarioEntry[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Orchestrator Module 4.1';
  workbook.created = new Date();

  buildSummarySheet(workbook, scenarios);

  const groups = groupByJob(scenarios);
  let sheetIndex = 1;
  for (const [jobId, entries] of groups) {
    const label = entries[0].source_title
      ? entries[0].source_title.slice(0, 25)
      : `Job ${jobId.slice(0, 8)}`;
    const sheetName = `${sheetIndex} - ${label}`.replace(/[\\/*?[\]:]/g, '').slice(0, 31);
    buildDetailSheet(workbook, sheetName, entries);
    sheetIndex++;
  }

  return workbook;
}

function buildSummarySheet(workbook: ExcelJS.Workbook, scenarios: ExportScenarioEntry[]): void {
  const sheet = workbook.addWorksheet('Prehľad', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  // Title
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'Test Scenarios Export';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF1F1B16' } };

  // Metadata row
  sheet.mergeCells('A2:G2');
  const metaCell = sheet.getCell('A2');
  metaCell.value = `Generované: ${formatDate(new Date().toISOString())} | Celkom scenárov: ${scenarios.length}`;
  metaCell.font = { size: 10, color: { argb: 'FF7A6F65' } };

  // Empty row 3
  const headerRow = 4;
  const headers = ['#', 'Názov testu', 'Typ', 'Klasifikácia', 'Priorita', 'Status', 'Job ID'];
  const widths = [6, 50, 14, 16, 12, 14, 14];

  headers.forEach((header, i) => {
    const cell = sheet.getCell(headerRow, i + 1);
    cell.value = header;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left' };
  });

  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  scenarios.forEach((entry, idx) => {
    const s = entry.scenario;
    const row = headerRow + 1 + idx;
    const values = [
      idx + 1,
      s.test_name || '',
      formatLabel(s.test_type || ''),
      formatLabel(s.scenario_classification || ''),
      formatLabel(s.priority || ''),
      formatLabel(s.validation_status || ''),
      entry.job_id.slice(0, 8),
    ];

    values.forEach((val, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = val;
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: true };
      cell.font = { size: 10 };
    });

    applyPriorityFill(sheet.getCell(row, 5), s.priority);
    applyStatusFill(sheet.getCell(row, 6), s.validation_status);
  });
}

function buildDetailSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  entries: ExportScenarioEntry[]
): void {
  const sheet = workbook.addWorksheet(sheetName);
  const first = entries[0];

  // Job metadata
  sheet.mergeCells('A1:D1');
  const srcCell = sheet.getCell('A1');
  srcCell.value = `Zdroj: ${first.source_title || first.source_link || 'Manual input'}`;
  srcCell.font = { bold: true, size: 12 };

  sheet.mergeCells('A2:D2');
  const metaParts = [
    first.parent_jira_issue_id ? `Jira: ${first.parent_jira_issue_id}` : null,
    `Vytvorené: ${formatDate(first.job_created_at)}`,
    `Scenárov: ${entries.length}`,
  ].filter(Boolean).join(' | ');
  const metaCell = sheet.getCell('A2');
  metaCell.value = metaParts;
  metaCell.font = { size: 10, color: { argb: 'FF7A6F65' } };

  let currentRow = 4;

  for (const entry of entries) {
    const s = entry.scenario;

    // Scenario header
    sheet.mergeCells(currentRow, 1, currentRow, 4);
    const nameCell = sheet.getCell(currentRow, 1);
    nameCell.value = s.test_name || 'Untitled';
    nameCell.font = { bold: true, size: 11, color: { argb: 'FF1F1B16' } };
    nameCell.fill = HEADER_FILL;
    nameCell.border = BORDER_THIN;
    currentRow++;

    // Meta badges row
    const metaLabels = [
      `Typ: ${formatLabel(s.test_type || '')}`,
      `Klasifikácia: ${formatLabel(s.scenario_classification || '')}`,
      `Priorita: ${formatLabel(s.priority || '')}`,
      `Status: ${formatLabel(s.validation_status || '')}`,
    ];
    metaLabels.forEach((label, i) => {
      const cell = sheet.getCell(currentRow, i + 1);
      cell.value = label;
      cell.font = { size: 9, color: { argb: 'FF7A6F65' } };
      cell.border = BORDER_THIN;
    });
    applyPriorityFill(sheet.getCell(currentRow, 3), s.priority);
    applyStatusFill(sheet.getCell(currentRow, 4), s.validation_status);
    currentRow++;

    // Description
    if (s.description) {
      sheet.mergeCells(currentRow, 1, currentRow, 4);
      const descCell = sheet.getCell(currentRow, 1);
      descCell.value = s.description;
      descCell.font = { size: 10, italic: true };
      descCell.alignment = { wrapText: true };
      descCell.border = BORDER_THIN;
      currentRow++;
    }

    // Preconditions
    const preconditions = Array.isArray(s.preconditions) ? s.preconditions : [];
    if (preconditions.length > 0) {
      sheet.mergeCells(currentRow, 1, currentRow, 4);
      const precCell = sheet.getCell(currentRow, 1);
      precCell.value = 'Predpoklady: ' + preconditions.join('; ');
      precCell.font = { size: 10 };
      precCell.alignment = { wrapText: true };
      precCell.border = BORDER_THIN;
      currentRow++;
    }

    // Test steps header
    const stepsHeaders = ['#', 'Akcia', 'Vstup', 'Očakávaný výsledok'];
    stepsHeaders.forEach((h, i) => {
      const cell = sheet.getCell(currentRow, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FF1F1B16' } };
      cell.fill = HEADER_FILL;
      cell.border = BORDER_THIN;
      cell.alignment = { horizontal: i === 0 ? 'center' : 'left' };
    });
    currentRow++;

    // Test steps
    const steps = Array.isArray(s.test_steps) ? s.test_steps : [];
    for (const step of steps) {
      const vals = [
        step.step_number,
        step.action || '',
        step.input || '',
        step.expected_result || '',
      ];
      vals.forEach((val, i) => {
        const cell = sheet.getCell(currentRow, i + 1);
        cell.value = val;
        cell.font = { size: 10 };
        cell.border = BORDER_THIN;
        cell.alignment = { wrapText: true, vertical: 'top', horizontal: i === 0 ? 'center' : 'left' };
      });
      currentRow++;
    }

    // Separator
    currentRow++;
  }

  // Column widths
  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 40;
  sheet.getColumn(3).width = 30;
  sheet.getColumn(4).width = 40;
}
