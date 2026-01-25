import { Router } from 'express';
import { FederationController } from '../controllers/federation';

export function createFederationRoutes(federationController: FederationController): Router {
  const router = Router();

  // OpenID Federation Entity Configuration endpoint
  // This endpoint returns the entity's own configuration as a signed JWT
  router.get('/.well-known/openid-federation', async (req, res) => {
    await federationController.handleEntityConfiguration(req, res);
  });

  // Federation Fetch endpoint
  // Used to fetch entity configurations of other federation entities
  router.post('/federation/fetch', async (req, res) => {
    await federationController.handleFederationFetch(req, res);
  });

  // Federation List endpoint  
  // Used to list subordinate entities
  router.post('/federation/list', async (req, res) => {
    await federationController.handleFederationList(req, res);
  });

  // Federation Resolve endpoint
  // Used to resolve trust chains for entities
  router.post('/federation/resolve', async (req, res) => {
    await federationController.handleFederationResolve(req, res);
  });

  // Dynamic Client Registration endpoint
  // Used for Federation-aware dynamic client registration
  router.post('/federation/register', async (req, res) => {
    await federationController.handleDynamicRegistration(req, res);
  });

  return router;
}

export default createFederationRoutes;