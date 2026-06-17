const SILENT_LOGGER = {
  info() {},
  error() {},
  debug() {},
  warn() {},
  fatal() {},
  trace() {},
  child() { return this; }
};

const ENV_DEFAULTS = {
  VERSA_API_KEY: 'test-key',
  VERSA_BASE_URL: 'http://127.0.0.1:1',
  APP_TRUNK_NAME: 'test-trunk',
  GATHER_DTMF_AUDIO_URL: 'http://example.test/g.wav',
  LOGLEVEL: 'silent'
};

async function startApp({env = {}} = {}) {
  // Snapshot the keys we will touch so we can restore them on close
  const mergedEnv = {...ENV_DEFAULTS, ...env};
  const snapshot = {};
  for (const key of Object.keys(mergedEnv)) {
    snapshot[key] = process.env[key];
  }

  // Set env FIRST so route modules read correct values at require-time
  Object.assign(process.env, mergedEnv);

  // Fresh module registry per app instance (jest.resetModules available in test context)
  if (typeof jest !== 'undefined') {
    jest.resetModules();
  }

  // eslint-disable-next-line import/no-dynamic-require
  const {createApp} = require('../../lib/create-app');

  const logger = SILENT_LOGGER;
  const {app, server, ongoingSessions, close: serverClose} = createApp({logger});

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const port = server.address().port;
  const baseHttpUrl = `http://127.0.0.1:${port}`;
  const baseWsUrl = `ws://127.0.0.1:${port}`;

  const close = async() => {
    await new Promise((resolve) => server.close(resolve));
    // Restore snapshotted env keys
    for (const key of Object.keys(snapshot)) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  };

  return {app, server, ongoingSessions, baseHttpUrl, baseWsUrl, close};
}

module.exports = {startApp};
