import { Router } from 'express';
import { AuthController } from '../controllers/auth';

export function createAuthRoutes(authController: AuthController): Router {
  const router = Router();

  // GET /login - Show login form
  router.get('/login', async (req, res) => {
    await authController.showLoginForm(req, res);
  });

  // POST /login - Handle login form submission
  router.post('/login', async (req, res) => {
    await authController.handleLogin(req, res);
  });

  // GET /consent - Show consent form
  router.get('/consent', async (req, res) => {
    await authController.showConsentForm(req, res);
  });

  // POST /consent - Handle consent form submission
  router.post('/consent', async (req, res) => {
    await authController.handleConsent(req, res);
  });

  return router;
}