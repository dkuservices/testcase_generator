/**
 * Dependency Detector
 * Automatically detects dependencies between pages/components
 * by analyzing Confluence content for references
 */

import { PageDependency } from '../models/page';
import { ComponentDependency } from '../models/component';
import { listPagesByComponent, getPage } from '../storage/page-store';
import { getComponent, listComponentsByProject } from '../storage/component-store';
import logger from '../utils/logger';

export interface DetectedDependency {
  target_id: string;
  target_name: string;
  target_type: 'page' | 'component';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  matched_text?: string;
}

/**
 * Detect dependencies from text content by matching against known page/component names
 */
export async function detectDependenciesFromContent(
  content: string,
  currentPageId: string,
  projectId: string
): Promise<DetectedDependency[]> {
  const dependencies: DetectedDependency[] = [];
  const contentLower = content.toLowerCase();

  try {
    // Get all components in the project
    const components = await listComponentsByProject(projectId);

    for (const component of components) {
      // Get all pages in each component
      const pages = await listPagesByComponent(component.component_id);

      for (const pageSummary of pages) {
        // Skip self-reference
        if (pageSummary.page_id === currentPageId) continue;

        const page = await getPage(pageSummary.page_id);
        if (!page) continue;

        // Check if page name is mentioned in content
        const pageName = page.name.toLowerCase();
        const pageNameWords = pageName.split(/\s+/).filter(w => w.length > 3);

        // High confidence: exact page name match
        if (contentLower.includes(pageName) && pageName.length > 5) {
          dependencies.push({
            target_id: page.page_id,
            target_name: page.name,
            target_type: 'page',
            confidence: 'high',
            reason: `Priama zmienka názvu stránky "${page.name}"`,
            matched_text: pageName,
          });
          continue;
        }

        // Medium confidence: most words from page name match
        const matchedWords = pageNameWords.filter(word =>
          contentLower.includes(word) && word.length > 4
        );
        if (matchedWords.length >= Math.ceil(pageNameWords.length * 0.7) && matchedWords.length >= 2) {
          dependencies.push({
            target_id: page.page_id,
            target_name: page.name,
            target_type: 'page',
            confidence: 'medium',
            reason: `Zhoda kľúčových slov: ${matchedWords.join(', ')}`,
            matched_text: matchedWords.join(' '),
          });
        }
      }

      // Check for component-level references
      const componentName = component.name.toLowerCase();
      if (contentLower.includes(componentName) && componentName.length > 5) {
        dependencies.push({
          target_id: component.component_id,
          target_name: component.name,
          target_type: 'component',
          confidence: 'high',
          reason: `Priama zmienka modulu "${component.name}"`,
          matched_text: componentName,
        });
      }
    }

    // Deduplicate by target_id, keeping highest confidence
    const deduped = new Map<string, DetectedDependency>();
    for (const dep of dependencies) {
      const existing = deduped.get(dep.target_id);
      if (!existing || confidenceRank(dep.confidence) > confidenceRank(existing.confidence)) {
        deduped.set(dep.target_id, dep);
      }
    }

    const result = Array.from(deduped.values());

    logger.info('Dependencies detected from content', {
      page_id: currentPageId,
      total_detected: result.length,
      high_confidence: result.filter(d => d.confidence === 'high').length,
      medium_confidence: result.filter(d => d.confidence === 'medium').length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to detect dependencies', {
      page_id: currentPageId,
      error: (error as Error).message,
    });
    return [];
  }
}

function confidenceRank(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

/**
 * Convert detected dependencies to PageDependency format for storage
 */
export function toPageDependencies(detected: DetectedDependency[]): PageDependency[] {
  return detected
    .filter(d => d.target_type === 'page')
    .map(d => ({
      page_id: d.target_id,
      page_name: d.target_name,
      relationship: 'collaborates' as const,
      notes: `${d.confidence}: ${d.reason}`,
    }));
}

/**
 * Convert detected dependencies to ComponentDependency format for storage
 */
export function toComponentDependencies(detected: DetectedDependency[]): ComponentDependency[] {
  return detected
    .filter(d => d.target_type === 'component')
    .map(d => ({
      component_id: d.target_id,
      component_name: d.target_name,
      relationship: 'collaborates' as const,
      notes: `${d.confidence}: ${d.reason}`,
    }));
}

/**
 * Detect dependencies for a component based on its pages' dependencies
 */
export async function detectComponentDependencies(
  componentId: string
): Promise<ComponentDependency[]> {
  const component = await getComponent(componentId);
  if (!component) return [];

  const pages = await listPagesByComponent(componentId);
  const componentDeps = new Map<string, ComponentDependency>();

  for (const pageSummary of pages) {
    const page = await getPage(pageSummary.page_id);
    if (!page?.dependencies) continue;

    for (const pageDep of page.dependencies) {
      // Get the component of the dependent page
      const depPage = await getPage(pageDep.page_id);
      if (!depPage || depPage.component_id === componentId) continue;

      const depComponent = await getComponent(depPage.component_id);
      if (!depComponent) continue;

      // Add component-level dependency
      if (!componentDeps.has(depComponent.component_id)) {
        componentDeps.set(depComponent.component_id, {
          component_id: depComponent.component_id,
          component_name: depComponent.name,
          relationship: 'collaborates',
          notes: `Odvodené zo závislostí stránok`,
        });
      }
    }
  }

  return Array.from(componentDeps.values());
}
