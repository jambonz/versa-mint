const express = require('express');
const nocache = require('nocache');
const cors = require('cors');
const passport = require('passport');
const helmet = require('helmet');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');

const createApp = ({env = process.env, logger} = {}) => {
  logger = logger || require('pino')({level: env.LOGLEVEL || 'debug'});

  const app = express();
  const apiRoutes = require('./api');

  app.use(express.urlencoded({extended: true}));
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
  app.use('/', (req, res, next) => { next(); }, apiRoutes);

  const server = createServer(app);
  const makeService = createEndpoint({server, logger, middlewares: [require('./middleware/basic-auth')({logger})]});

  const ongoingSessions = new Map();

  app.locals = {logger, ongoingSessions};

  require('./routes')({logger, makeService, ongoingSessions});

  return {
    app,
    server,
    makeService,
    ongoingSessions,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

module.exports = {createApp};
