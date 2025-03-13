const router = require('express').Router();

router.post('/', (req, res) => {
  const {logger} = req.app.locals;
  logger.debug({payload: req.body}, 'action Hook');
  res.status(200).json([]);
});

module.exports = router;
