/* eslint-disable @typescript-eslint/no-var-requires */
import { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import path from 'path';
import { ExportScenarioEntry, PRIORITY_COLORS, STATUS_COLORS } from './export-types';

// pdfmake exports a singleton instance - import * as doesn't bind prototype methods
const pdfmake = require('pdfmake') as typeof import('pdfmake');

// Configure fonts for server-side PDF generation
const fontsDir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
pdfmake.setFonts({
  Roboto: {
    normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
  },
});

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
}

function hexColor(hex: string): string {
  return '#' + hex;
}

function buildBadge(label: string, colors: { bg: string; text: string }): Content {
  return {
    text: label,
    fontSize: 8,
    color: hexColor(colors.text),
    background: hexColor(colors.bg),
    bold: true,
  };
}

function buildScenarioContent(entry: ExportScenarioEntry, index: number): Content[] {
  const s = entry.scenario;
  const content: Content[] = [];

  // Scenario name
  content.push({
    text: `${index + 1}. ${s.test_name || 'Untitled'}`,
    style: 'scenarioTitle',
    margin: [0, index > 0 ? 20 : 0, 0, 6] as [number, number, number, number],
  });

  // Badge line
  const badges: Content[] = [
    buildBadge(formatLabel(s.test_type || ''), { bg: 'EFE8DF', text: '1F1B16' }),
    { text: '  ' },
    buildBadge(formatLabel(s.scenario_classification || ''), { bg: 'EFE8DF', text: '1F1B16' }),
    { text: '  ' },
    buildBadge(formatLabel(s.priority || ''), PRIORITY_COLORS[s.priority] || { bg: 'EFE8DF', text: '1F1B16' }),
    { text: '  ' },
    buildBadge(formatLabel(s.validation_status || ''), STATUS_COLORS[s.validation_status] || { bg: 'EFE8DF', text: '1F1B16' }),
  ];
  content.push({ text: badges, margin: [0, 0, 0, 8] as [number, number, number, number] });

  // Description
  if (s.description) {
    content.push({
      text: s.description,
      fontSize: 10,
      italics: true,
      color: '#7A6F65',
      margin: [0, 0, 0, 8] as [number, number, number, number],
    });
  }

  // Preconditions
  const preconditions = Array.isArray(s.preconditions) ? s.preconditions : [];
  if (preconditions.length > 0) {
    content.push({
      text: 'Predpoklady:',
      fontSize: 9,
      bold: true,
      color: '#7A6F65',
      margin: [0, 0, 0, 4] as [number, number, number, number],
    });
    content.push({
      ul: preconditions,
      fontSize: 9,
      color: '#1F1B16',
      margin: [0, 0, 0, 8] as [number, number, number, number],
    } as any);
  }

  // Test steps table
  const steps = Array.isArray(s.test_steps) ? s.test_steps : [];
  if (steps.length > 0) {
    const tableBody: TableCell[][] = [
      [
        { text: '#', style: 'tableHeader' },
        { text: 'Akcia', style: 'tableHeader' },
        { text: 'Vstup', style: 'tableHeader' },
        { text: 'Očakávaný výsledok', style: 'tableHeader' },
      ],
    ];

    for (const step of steps) {
      tableBody.push([
        { text: String(step.step_number || ''), fontSize: 9, alignment: 'center' },
        { text: step.action || '', fontSize: 9 },
        { text: step.input || '', fontSize: 9 },
        { text: step.expected_result || '', fontSize: 9 },
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: [20, '*', '*', '*'],
        body: tableBody,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#D6CFC7',
        vLineColor: () => '#D6CFC7',
        fillColor: (rowIndex: number) => (rowIndex === 0 ? '#EFE8DF' : null),
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [0, 0, 0, 8] as [number, number, number, number],
    });
  }

  // Metadata line
  const metaParts = [
    s.test_repository_folder ? `Priečinok: ${s.test_repository_folder}` : null,
    `Automatizácia: ${formatLabel(s.automation_status || 'N/A')}`,
    entry.parent_jira_issue_id ? `Jira: ${entry.parent_jira_issue_id}` : null,
  ].filter(Boolean).join(' | ');

  content.push({
    text: metaParts,
    fontSize: 8,
    color: '#7A6F65',
    margin: [0, 0, 0, 4] as [number, number, number, number],
  });

  // Separator line
  content.push({
    canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#D6CFC7' }],
    margin: [0, 8, 0, 0] as [number, number, number, number],
  });

  return content;
}

export async function generatePdfReport(scenarios: ExportScenarioEntry[]): Promise<Buffer> {
  const allContent: Content[] = [];

  // Title
  allContent.push({
    text: 'Test Scenarios Report',
    style: 'title',
    margin: [0, 0, 0, 4] as [number, number, number, number],
  });

  // Subtitle
  allContent.push({
    text: `Generované: ${formatDate(new Date().toISOString())} | Celkom scenárov: ${scenarios.length}`,
    fontSize: 10,
    color: '#7A6F65',
    margin: [0, 0, 0, 16] as [number, number, number, number],
  });

  // Separator
  allContent.push({
    canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#0F766E' }],
    margin: [0, 0, 0, 16] as [number, number, number, number],
  });

  // Scenarios
  scenarios.forEach((entry, index) => {
    allContent.push(...buildScenarioContent(entry, index));
  });

  const docDefinition: TDocumentDefinitions = {
    content: allContent,
    styles: {
      title: {
        fontSize: 20,
        bold: true,
        color: '#1F1B16',
      },
      scenarioTitle: {
        fontSize: 13,
        bold: true,
        color: '#1F1B16',
      },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: '#1F1B16',
      },
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
    },
    pageMargins: [40, 40, 40, 40] as [number, number, number, number],
    footer: (currentPage: number, pageCount: number) => ({
      text: `AI Orchestrator Module 4.1 | Strana ${currentPage} z ${pageCount}`,
      alignment: 'center' as const,
      fontSize: 8,
      color: '#7A6F65',
      margin: [0, 10, 0, 0] as [number, number, number, number],
    }),
  };

  const pdf = pdfmake.createPdf(docDefinition);
  return pdf.getBuffer();
}
