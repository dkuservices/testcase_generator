import { Router, Request, Response, NextFunction } from 'express';
import { listJobs } from '../../storage/job-store';
import { listProjects } from '../../storage/project-store';

const router = Router();

router.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [projectsResult, jobsResult] = await Promise.all([
      listProjects(),
      listJobs(undefined, { limit: 200, offset: 0 }),
    ]);

    const projects = projectsResult.projects || [];
    let totalComponents = 0;
    let totalPages = 0;
    let totalTests = 0;

    for (const p of projects) {
      totalComponents += p.component_count || 0;
      totalPages += p.total_pages || 0;
      totalTests += p.total_tests || 0;
    }

    // Recent jobs (last 5)
    const recentJobs = (jobsResult.jobs || []).slice(0, 5);

    res.json({
      stats: {
        total_projects: projects.length,
        total_components: totalComponents,
        total_pages: totalPages,
        total_tests: totalTests,
      },
      recent_jobs: recentJobs,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
