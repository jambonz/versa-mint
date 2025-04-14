const assert = require('assert');
assert.ok(process.env.VERSA_API_KEY, 'You must define the VERSA_API_KEY env variable');
assert.ok(process.env.VERSA_BASE_URL, 'You must define the VERSA_BASE_URL env variable');
assert.ok(process.env.APP_TRUNK_NAME, 'You must define the APP_TRUNK_NAME env variable');

const port = process.env.HTTP_PORT || 3000;
const express = require('express');
const app = express();
const nocache = require('nocache');
const cors = require('cors');
const passport = require('passport');
const helmet = require('helmet');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer(app);
const makeService = createEndpoint({server});
const logger = require('pino')({level: process.env.LOGLEVEL || 'debug'});
const apiRoutes = require('./lib/api');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet());
app.use(helmet.hidePoweredBy());
app.use(nocache());
app.use(passport.initialize());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['Content-Type']
}));
app.use('/', (req, res, next) => {next();}, apiRoutes);

require('./lib/routes')({logger, makeService});


server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});