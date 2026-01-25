import { Router } from 'express';
import { IntrospectionController } from '../controllers/introspection';
import { introspectionRateLimit } from '../middleware/rateLimiting';
import { validateIntrospectionRequest } from '../middleware/validation';

export function createIntrospectionRoutes(introspectionController: IntrospectionController): Router {
  const router = Router();

  // POST /introspect - OAuth 2.0 token introspection endpoint
  router.post('/introspect', introspectionRateLimit(), validateIntrospectionRequest(), async (req, res) => {
    await introspectionController.handleIntrospectionRequest(req, res);
  });

  return router;
}