const router = require('express').Router();

router.use('/audios', require('./audios'));
router.use('/calls', require('./update-call'));
router.use('/sip-errors', require('./sip-errors'));

module.exports = router;
