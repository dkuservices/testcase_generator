/**
 * Word Document Parser
 * Parses .docx files and extracts structured content
 */

import mammoth from 'mammoth';
import { JSDOM } from 'jsdom';
import { DocumentSection } from '../models/word-document';
import { createContextLogger } from '../utils/logger';

interface ParseResult {
  sections: DocumentSection[];
  raw_text: string;
}

/**
 * Parse a Word document buffer and extract structured sections
 */
export async function parseWordDocument(
  buffer: Buffer,
  filename: string
): Promise<ParseResult> {
  const contextLogger = createContextLogger({
    step: 'word_parsing',
    filename,
  });

  contextLogger.info('Starting Word document parsing');

  try {
    // Convert Word document to HTML
    const result = await mammoth.convertToHtml({ buffer });

    if (result.messages.length > 0) {
      contextLogger.warn('Mammoth conversion warnings', {
        messages: result.messages,
      });
    }

    const html = result.value;
    contextLogger.debug('HTML conversion complete', {
      html_length: html.length,
    });

    // Extract raw text
    const rawTextResult = await mammoth.extractRawText({ buffer });
    const rawText = rawTextResult.value;

    // Parse HTML to extract sections
    const sections = extractSectionsFromHtml(html, contextLogger);

    contextLogger.info('Word document parsing complete', {
      sections_count: sections.length,
      raw_text_length: rawText.length,
    });

    return {
      sections,
      raw_text: rawText,
    };
  } catch (error: any) {
    contextLogger.error('Failed to parse Word document', {
      error: error.message,
    });
    throw new Error(`Failed to parse Word document: ${error.message}`);
  }
}

/**
 * Extract sections from HTML based on heading levels
 */
function extractSectionsFromHtml(
  html: string,
  logger: ReturnType<typeof createContextLogger>
): DocumentSection[] {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const body = document.body;

  const sections: DocumentSection[] = [];
  let currentSection: DocumentSection | null = null;
  let sectionStack: { section: DocumentSection; level: number }[] = [];

  const children = Array.from(body.childNodes) as ChildNode[];

  for (const node of children) {
    if (node.nodeType !== 1) continue; // Skip non-element nodes

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    // Check if it's a heading
    const headingMatch = tagName.match(/^h([1-6])$/);

    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      const headingText = element.textContent?.trim() || '';

      if (!headingText) continue;

      const newSection: DocumentSection = {
        heading: headingText,
        level,
        content: '',
        subsections: [],
      };

      // Find appropriate parent based on level
      while (
        sectionStack.length > 0 &&
        sectionStack[sectionStack.length - 1].level >= level
      ) {
        sectionStack.pop();
      }

      if (sectionStack.length === 0) {
        // Top-level section
        sections.push(newSection);
      } else {
        // Subsection
        sectionStack[sectionStack.length - 1].section.subsections.push(
          newSection
        );
      }

      sectionStack.push({ section: newSection, level });
      currentSection = newSection;
    } else if (currentSection) {
      // Add content to current section
      const text = element.textContent?.trim() || '';
      if (text) {
        if (currentSection.content) {
          currentSection.content += '\n' + text;
        } else {
          currentSection.content = text;
        }
      }
    } else {
      // Content before first heading - create implicit section
      const text = element.textContent?.trim() || '';
      if (text) {
        if (sections.length === 0 || sections[0].heading !== 'Introduction') {
          const introSection: DocumentSection = {
            heading: 'Introduction',
            level: 1,
            content: text,
            subsections: [],
          };
          sections.unshift(introSection);
          currentSection = introSection;
          sectionStack = [{ section: introSection, level: 1 }];
        } else {
          sections[0].content += '\n' + text;
        }
      }
    }
  }

  logger.debug('Extracted sections', {
    top_level_sections: sections.length,
    section_titles: sections.map((s) => s.heading),
  });

  return sections;
}

/**
 * Flatten sections into a list with their content
 */
export function flattenSections(sections: DocumentSection[]): string {
  let result = '';

  function processSectionRecursive(section: DocumentSection, depth: number) {
    const prefix = '#'.repeat(Math.min(depth, 6));
    result += `${prefix} ${section.heading}\n\n`;

    if (section.content) {
      result += `${section.content}\n\n`;
    }

    for (const subsection of section.subsections) {
      processSectionRecursive(subsection, depth + 1);
    }
  }

  for (const section of sections) {
    processSectionRecursive(section, 1);
  }

  return result.trim();
}

/**
 * Get section count including subsections
 */
export function countAllSections(sections: DocumentSection[]): number {
  let count = 0;

  function countRecursive(sectionList: DocumentSection[]) {
    for (const section of sectionList) {
      count++;
      countRecursive(section.subsections);
    }
  }

  countRecursive(sections);
  return count;
}
