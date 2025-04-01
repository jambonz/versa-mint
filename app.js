const assert = require('assert');
assert.ok(process.env.VERSA_API_KEY, 'You must define the VERSA_API_KEY env variable');
assert.ok(process.env.VERSA_BASE_URL, 'You must define the VERSA_BASE_URL env variable');
assert.ok(process.env.APP_TRUNK_NAME, 'You must define the APP_TRUNK_NAME env variable');

const port = process.env.HTTP_PORT || 3000;
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer();
const makeService = createEndpoint({server});
const logger = require('pino')({level: process.env.LOGLEVEL || 'debug'});

require('./lib/routes')({logger, makeService});


server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});