import path from 'path';
import { Component, ComponentSummary, CreateComponentInput, UpdateComponentInput, ComponentTests } from '../models/component';
import { GeneratedTestScenario } from '../models/test-scenario';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile, ensureDirectoryExists } from './json-storage';
import { generateTestId } from '../utils/uuid-generator';
import logger from '../utils/logger';
import { deletePage, listPagesByComponent } from './page-store';

const COMPONENTS_DIR = path.join(process.cwd(), 'data', 'components');

export async function saveComponent(component: Component): Promise<void> {
  await ensureDirectoryExists(COMPONENTS_DIR);
  const filePath = path.join(COMPONENTS_DIR, `${component.component_id}.json`);
  await writeJSON(filePath, component);
  logger.debug('Component saved', { component_id: component.component_id, name: component.name });
}

export async function createComponent(projectId: string, input: CreateComponentInput): Promise<Component> {
  const now = new Date().toISOString();
  const component: Component = {
    component_id: generateTestId(),
    project_id: projectId,
    name: input.name,
    description: input.description,
    page_ids: [],
    created_at: now,
    updated_at: now,
  };

  await saveComponent(component);
  logger.info('Component created', { component_id: component.component_id, project_id: projectId, name: component.name });
  return component;
}

export async function getComponent(componentId: string): Promise<Component | null> {
  const filePath = path.join(COMPONENTS_DIR, `${componentId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<Component>(filePath);
  } catch (error) {
    logger.error('Failed to read component', { component_id: componentId, error: (error as Error).message });
    return null;
  }
}

export async function updateComponent(componentId: string, updates: UpdateComponentInput): Promise<Component> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  const updatedComponent: Component = {
    ...component,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await saveComponent(updatedComponent);
  logger.info('Component updated', { component_id: componentId });
  return updatedComponent;
}

export async function deleteComponent(componentId: string): Promise<void> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  // Cascade delete all pages
  for (const pageId of component.page_ids) {
    try {
      await deletePage(pageId);
    } catch (error) {
      logger.warn('Failed to delete page during component cascade', {
        component_id: componentId,
        page_id: pageId,
        error: (error as Error).message,
      });
    }
  }

  const filePath = path.join(COMPONENTS_DIR, `${component.component_id}.json`);
  await deleteFile(filePath);
  logger.info('Component deleted', { component_id: componentId });
}

export async function addPageToComponent(componentId: string, pageId: string): Promise<void> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  if (!component.page_ids.includes(pageId)) {
    component.page_ids.push(pageId);
    component.updated_at = new Date().toISOString();
    await saveComponent(component);
    logger.debug('Page added to component', { component_id: componentId, page_id: pageId });
  }
}

export async function removePageFromComponent(componentId: string, pageId: string): Promise<void> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  component.page_ids = component.page_ids.filter(id => id !== pageId);
  component.updated_at = new Date().toISOString();
  await saveComponent(component);
  logger.debug('Page removed from component', { component_id: componentId, page_id: pageId });
}

export async function saveComponentTests(
  componentId: string,
  scenarios: GeneratedTestScenario[],
  batchJobId?: string
): Promise<void> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  const componentTests: ComponentTests = {
    batch_job_id: batchJobId,
    scenarios,
    generated_at: new Date().toISOString(),
  };

  component.component_tests = componentTests;
  component.updated_at = new Date().toISOString();
  await saveComponent(component);
  logger.info('Component tests saved', {
    component_id: componentId,
    scenario_count: scenarios.length,
  });
}

export async function getComponentTests(componentId: string): Promise<GeneratedTestScenario[]> {
  const component = await getComponent(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  return component.component_tests?.scenarios || [];
}

export async function listComponentsByProject(projectId: string): Promise<ComponentSummary[]> {
  await ensureDirectoryExists(COMPONENTS_DIR);
  const files = await listFiles(COMPONENTS_DIR, '.json');

  const components: Component[] = [];
  for (const file of files) {
    const filePath = path.join(COMPONENTS_DIR, file);
    try {
      const component = await readJSON<Component>(filePath);
      if (component.project_id === projectId) {
        components.push(component);
      }
    } catch (error) {
      logger.warn('Failed to read component file', { file, error: (error as Error).message });
    }
  }

  // Sort by updated_at descending
  components.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  // Calculate summaries
  const summaries: ComponentSummary[] = await Promise.all(
    components.map(async component => {
      let pageLevelTests = 0;

      // Get page summaries
      const pages = await listPagesByComponent(component.component_id);
      for (const page of pages) {
        pageLevelTests += page.test_count;
      }

      return {
        component_id: component.component_id,
        project_id: component.project_id,
        name: component.name,
        description: component.description,
        page_count: component.page_ids.length,
        page_level_tests: pageLevelTests,
        component_level_tests: component.component_tests?.scenarios.length || 0,
        created_at: component.created_at,
        updated_at: component.updated_at,
      };
    })
  );

  return summaries;
}
