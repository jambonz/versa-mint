const router = require('express').Router();
const WebhookResponse = require('@jambonz/node-client').WebhookResponse;

router.post('/', (req, res) => {
  const {logger} = req.app.locals;
  logger.debug({payload: req.body}, 'refer Hook');
  const {refer_details} = req.body;
  const {refer_to_user} = refer_details;
  const app = new WebhookResponse();
  app.sip_refer({
    referTo: refer_to_user,
    actionHook: '/apps/refer-hook/action-hook',
  });
  res.status(200).json(app);
});

router.post('/action-hook', (req, res) => {
  const {logger} = req.app.locals;
  logger.debug({payload: req.body}, 'refer Hook');
  const app = new WebhookResponse();
  app.hangup();
  res.status(200).json(app);
});

module.exports = router;
