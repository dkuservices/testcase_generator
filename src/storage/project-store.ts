import path from 'path';
import { Project, ProjectSummary, ProjectContext, CreateProjectInput, UpdateProjectInput } from '../models/project';
import { GeneratedTestScenario } from '../models/test-scenario';
import { readJSON, writeJSON, fileExists, listFiles, deleteFile, ensureDirectoryExists } from './json-storage';
import { generateTestId } from '../utils/uuid-generator';
import logger from '../utils/logger';
import { deleteComponent, listComponentsByProject } from './component-store';
import {
  saveManualFile as saveManualFileRaw,
  getStoredManualPath as getStoredManualPathRaw,
  deleteManualFile as deleteManualFileRaw,
} from './document-store';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

function manualKey(projectId: string): string {
  return `project_${projectId}`;
}

export async function saveProject(project: Project): Promise<void> {
  await ensureDirectoryExists(PROJECTS_DIR);
  const filePath = path.join(PROJECTS_DIR, `${project.project_id}.json`);
  await writeJSON(filePath, project);
  logger.debug('Project saved', { project_id: project.project_id, name: project.name });
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    project_id: generateTestId(),
    name: input.name,
    description: input.description,
    component_ids: [],
    created_at: now,
    updated_at: now,
    metadata: input.metadata,
  };

  await saveProject(project);
  logger.info('Project created', { project_id: project.project_id, name: project.name });
  return project;
}

export async function getProject(projectId: string): Promise<Project | null> {
  const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJSON<Project>(filePath);
  } catch (error) {
    logger.error('Failed to read project', { project_id: projectId, error: (error as Error).message });
    return null;
  }
}

export async function updateProject(projectId: string, updates: UpdateProjectInput): Promise<Project> {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const updatedProject: Project = {
    ...project,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await saveProject(updatedProject);
  logger.info('Project updated', { project_id: projectId });
  return updatedProject;
}

export async function deleteProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Clean up manual file if exists
  if (project.project_context) {
    try {
      await deleteManualFileRaw(manualKey(projectId));
    } catch (error) {
      logger.warn('Failed to delete project manual file during cascade', {
        project_id: projectId,
        error: (error as Error).message,
      });
    }
  }

  // Cascade delete all components (which will cascade delete pages)
  for (const componentId of project.component_ids) {
    try {
      await deleteComponent(componentId);
    } catch (error) {
      logger.warn('Failed to delete component during project cascade', {
        project_id: projectId,
        component_id: componentId,
        error: (error as Error).message,
      });
    }
  }

  const filePath = path.join(PROJECTS_DIR, `${project.project_id}.json`);
  await deleteFile(filePath);
  logger.info('Project deleted', { project_id: projectId });
}

export async function addComponentToProject(projectId: string, componentId: string): Promise<void> {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.component_ids.includes(componentId)) {
    project.component_ids.push(componentId);
    project.updated_at = new Date().toISOString();
    await saveProject(project);
    logger.debug('Component added to project', { project_id: projectId, component_id: componentId });
  }
}

export async function removeComponentFromProject(projectId: string, componentId: string): Promise<void> {
  const project = await getProject(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  project.component_ids = project.component_ids.filter(id => id !== componentId);
  project.updated_at = new Date().toISOString();
  await saveProject(project);
  logger.debug('Component removed from project', { project_id: projectId, component_id: componentId });
}

export async function saveProjectTests(
  projectId: string,
  scenarios: GeneratedTestScenario[],
  batchJobId: string
): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  project.project_tests = {
    batch_job_id: batchJobId,
    scenarios,
    generated_at: new Date().toISOString(),
  };
  project.updated_at = new Date().toISOString();

  await saveProject(project);
  logger.info('Project tests saved', {
    project_id: projectId,
    scenario_count: scenarios.length,
    batch_job_id: batchJobId,
  });
}

export async function getProjectTests(projectId: string): Promise<GeneratedTestScenario[]> {
  const project = await getProject(projectId);
  if (!project) {
    return [];
  }
  return project.project_tests?.scenarios || [];
}

export async function listProjects(): Promise<{ total: number; projects: ProjectSummary[] }> {
  await ensureDirectoryExists(PROJECTS_DIR);
  const files = await listFiles(PROJECTS_DIR, '.json');

  const projects: Project[] = [];
  for (const file of files) {
    const filePath = path.join(PROJECTS_DIR, file);
    try {
      const project = await readJSON<Project>(filePath);
      projects.push(project);
    } catch (error) {
      logger.warn('Failed to read project file', { file, error: (error as Error).message });
    }
  }

  // Sort by updated_at descending
  projects.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  // Calculate summaries
  const summaries: ProjectSummary[] = await Promise.all(
    projects.map(async project => {
      let totalPages = 0;
      let totalTests = 0;

      // Get component summaries
      const components = await listComponentsByProject(project.project_id);
      for (const comp of components) {
        totalPages += comp.page_count;
        totalTests += comp.page_level_tests + comp.component_level_tests;
      }

      const projectLevelTests = project.project_tests?.scenarios?.length || 0;

      return {
        project_id: project.project_id,
        name: project.name,
        description: project.description,
        component_count: project.component_ids.length,
        total_pages: totalPages,
        total_tests: totalTests,
        project_level_tests: projectLevelTests,
        created_at: project.created_at,
        updated_at: project.updated_at,
        source_type: project.metadata?.source_type,
      };
    })
  );

  return { total: summaries.length, projects: summaries };
}

// ── Project Manual/Handbook Storage ─────────────────────────────────────

export async function saveProjectContext(
  projectId: string,
  context: ProjectContext
): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  project.project_context = context;
  project.updated_at = new Date().toISOString();
  await saveProject(project);

  logger.info('Project context saved', {
    project_id: projectId,
    has_text: !!context.manual_text,
    has_file: !!context.manual_file,
    is_chunked: !!context.is_chunked,
  });
}

export async function getProjectContext(
  projectId: string
): Promise<ProjectContext | null> {
  const project = await getProject(projectId);
  return project?.project_context || null;
}

export async function deleteProjectContext(
  projectId: string
): Promise<boolean> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.project_context) {
    return false;
  }

  await deleteManualFileRaw(manualKey(projectId));

  project.project_context = undefined;
  project.updated_at = new Date().toISOString();
  await saveProject(project);

  logger.info('Project context deleted', { project_id: projectId });
  return true;
}

export async function saveProjectManualFile(
  projectId: string,
  sourcePath: string,
  originalFilename: string
): Promise<string> {
  return saveManualFileRaw(manualKey(projectId), sourcePath, originalFilename);
}

export async function getProjectManualPath(
  projectId: string
): Promise<string | null> {
  return getStoredManualPathRaw(manualKey(projectId));
}
