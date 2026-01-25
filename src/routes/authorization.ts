import { Router } from 'express';
import { AuthorizationController } from '../controllers/authorization';
import { authorizationRateLimit } from '../middleware/rateLimiting';
import { validateAuthorizationRequest } from '../middleware/validation';

export function createAuthorizationRoutes(authorizationController: AuthorizationController): Router {
  const router = Router();

  // GET /authorize - OAuth 2.0 authorization endpoint
  router.get('/authorize', authorizationRateLimit(), validateAuthorizationRequest(), async (req, res) => {
    await authorizationController.handleAuthorizationRequest(req, res);
  });

  return router;
}