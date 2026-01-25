import { Router } from 'express';
import { TokenController } from '../controllers/token';
import { tokenRateLimit } from '../middleware/rateLimiting';
import { validateTokenRequest } from '../middleware/validation';

export function createTokenRoutes(tokenController: TokenController): Router {
  const router = Router();

  // POST /token - OAuth 2.0 token endpoint
  router.post('/token', tokenRateLimit(), validateTokenRequest(), async (req, res) => {
    await tokenController.handleTokenRequest(req, res);
  });

  return router;
}