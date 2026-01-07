import * as cheerio from 'cheerio';
import logger from './logger';

export function stripHTMLTags(html: string): string {
  try {
    const $ = cheerio.load(html);

    $('script, style, comment, macro').remove();

    let text = $.text();

    text = text.replace(/\s+/g, ' ').trim();

    return text;
  } catch (error) {
    logger.warn('HTML parsing error, attempting text extraction', { error: (error as Error).message });
    const stripped = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped;
  }
}

export function extractTextFromConfluence(confluenceHTML: string): string {
  try {
    const $ = cheerio.load(confluenceHTML);

    $('ac\\:structured-macro, .confluence-information-macro, .comment').remove();

    const text = $.text()
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  } catch (error) {
    logger.warn('Confluence HTML parsing error', { error: (error as Error).message });
    return stripHTMLTags(confluenceHTML);
  }
}
