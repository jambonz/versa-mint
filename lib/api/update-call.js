const express = require('express');
const routes = express.Router();

routes.put('/:sid', async (req, res) => {
  const { logger, ongoingSessions } = req.app.locals
  const { sid } = req.params;
  const { callerId, recordAction } = req.body || {};
  logger.info({ sid, body: req.body }, `update-call request received`);

  if (!ongoingSessions.has(sid)) {
      logger.warn({ sid }, `No ongoing session found for call SID ${sid}`);
      return res.status(404).json({ error: 'Call not found' });
    }

  if (callerId) {
    const session = ongoingSessions.get(sid);
    session.locals.currentCallerId = callerId;
    logger.info({ sid, callerId }, `Updated caller ID for call SID ${sid}`);
  }
  if (recordAction) {
    const session = ongoingSessions.get(sid);
    session.sendCommand('record', {
        action: recordAction,
      });
    logger.info({ sid, recordAction }, `Updated record action for call SID ${sid}`);
  }

  // Respond with a success message
  res.status(200).json({ status: 'ok' });
});

module.exports = routes;