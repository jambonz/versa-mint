const { authCall } = require('../utils');

const router = require('express').Router();
const WebhookResponse = require('@jambonz/node-client').WebhookResponse;

router.post('/', async (req, res) => {
  const {logger} = req.app.locals;
  logger.info({payload: req.body}, 'POST /dial');
  try {
    const app = new WebhookResponse();
    const { from, to } = req.body;
    const { statusCode, body } = await authCall(from);
    // User is not allowed to make calls
    if (statusCode !== 200) {
      logger.error({statusCode, body}, 'Error while authenticating user');
      app
        .hangup();
    } else {
      app
        .dial({
          answerOnBridge: true,
          actionHook: '/action-hook',
          referHook: '/refer-hook',
          headers: body,
          timeLimit: 60 * 60, // 1 hour
          target: [
            {
              type: 'phone',
              number: to,
              trunk: process.env.APP_TRUNK_NAME
            }
          ]
        });
    }
    
    res.status(200).json(app);
  } catch (err) {
    logger.error({err}, 'Error');
    res.sendStatus(503);
  }
});

module.exports = router;
