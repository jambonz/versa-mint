const express = require('express');
const routes = express.Router();
const {listErrors} = require('../routes/utils');

routes.get('/', (req, res) => {
  res.status(200).json(listErrors());
});

module.exports = routes;
