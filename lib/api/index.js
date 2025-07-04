const router = require('express').Router();

router.use('/audios', require('./audios'));
router.use('/calls', require('./update-call'));

module.exports = router;
