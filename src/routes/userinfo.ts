import { Router } from 'express';
import { UserInfoControllerImpl } from '../controllers/userinfo';
import { AuthleteClientImpl } from '../authlete/client';
import { config } from '../config';

const router = Router();
const authleteClient = new AuthleteClientImpl(config.authlete);
const userInfoController = new UserInfoControllerImpl(authleteClient);

// OpenID Connect UserInfo endpoint
router.get('/userinfo', async (req, res) => {
  await userInfoController.handleUserInfoRequest(req, res);
});

router.post('/userinfo', async (req, res) => {
  await userInfoController.handleUserInfoRequest(req, res);
});

export default router;