import { Router, Request, Response } from 'express';
import { ExecutionModesConfig } from '../../models/config';

const router = Router();

const startTime = Date.now();

export function createHealthRoute(executionModes: ExecutionModesConfig): Router {
  router.get('/', (req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    res.json({
      status: 'healthy',
      version: '1.0.0',
      uptime_seconds: uptime,
      mode: {
        scheduled: executionModes.scheduled.enabled,
        event_driven: executionModes.event_driven.enabled,
        manual: executionModes.manual.enabled,
      },
    });
  });

  return router;
}
