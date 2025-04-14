const router = require('express').Router();

router.use('/audios', require('./audios'));

module.exports = router;
