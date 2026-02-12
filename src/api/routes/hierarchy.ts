import { Router, Request, Response, NextFunction } from 'express';
import { listProjects, getProject } from '../../storage/project-store';
import { listComponentsByProject } from '../../storage/component-store';
import { listPagesByComponent } from '../../storage/page-store';

const router = Router();

interface HierarchyNode {
  id: string;
  name: string;
  type: 'project' | 'component' | 'page';
  children?: HierarchyNode[];
  metadata?: Record<string, unknown>;
}

// GET /api/hierarchy - Get full tree for sidebar
router.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projects } = await listProjects();

    const tree: HierarchyNode[] = await Promise.all(
      projects.map(async projectSummary => {
        const components = await listComponentsByProject(projectSummary.project_id);

        const componentNodes: HierarchyNode[] = await Promise.all(
          components.map(async comp => {
            const pages = await listPagesByComponent(comp.component_id);

            const pageNodes: HierarchyNode[] = pages.map(page => ({
              id: page.page_id,
              name: page.name,
              type: 'page' as const,
              metadata: {
                confluence_link: page.confluence_link,
                test_count: page.test_count,
                last_generated: page.last_generated,
              },
            }));

            return {
              id: comp.component_id,
              name: comp.name,
              type: 'component' as const,
              children: pageNodes,
              metadata: {
                page_count: comp.page_count,
                page_level_tests: comp.page_level_tests,
                component_level_tests: comp.component_level_tests,
              },
            };
          })
        );

        return {
          id: projectSummary.project_id,
          name: projectSummary.name,
          type: 'project' as const,
          children: componentNodes,
          metadata: {
            component_count: projectSummary.component_count,
            total_pages: projectSummary.total_pages,
            total_tests: projectSummary.total_tests,
          },
        };
      })
    );

    res.json({ hierarchy: tree });
  } catch (error) {
    next(error);
  }
});

// GET /api/hierarchy/:projectId - Get tree for specific project
router.get('/:projectId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await getProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found', project_id: projectId });
      return;
    }

    const components = await listComponentsByProject(projectId);

    const componentNodes: HierarchyNode[] = await Promise.all(
      components.map(async comp => {
        const pages = await listPagesByComponent(comp.component_id);

        const pageNodes: HierarchyNode[] = pages.map(page => ({
          id: page.page_id,
          name: page.name,
          type: 'page' as const,
          metadata: {
            confluence_link: page.confluence_link,
            test_count: page.test_count,
            last_generated: page.last_generated,
          },
        }));

        return {
          id: comp.component_id,
          name: comp.name,
          type: 'component' as const,
          children: pageNodes,
          metadata: {
            page_count: comp.page_count,
            page_level_tests: comp.page_level_tests,
            component_level_tests: comp.component_level_tests,
          },
        };
      })
    );

    const projectNode: HierarchyNode = {
      id: project.project_id,
      name: project.name,
      type: 'project',
      children: componentNodes,
      metadata: {
        description: project.description,
        component_count: project.component_ids.length,
      },
    };

    res.json({ hierarchy: projectNode });
  } catch (error) {
    next(error);
  }
});

export default router;
