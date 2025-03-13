const router = require('express').Router();

router.use('/action-hook', require('./action-hook'));
router.use('/refer-hook', require('./refer-hook'));
router.use('/dial', require('./dial'));
router.use('/call-status', require('./call-status'));

module.exports = router;
