const express = require('express');
const {createServer} = require('http');

async function startFakeUpstream({routes} = {}) {
  const app = express();
  app.use(express.json());

  const requests = [];

  // Capture every request
  app.use((req, res, next) => {
    requests.push({
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body
    });
    next();
  });

  // Default handlers
  const handlers = new Map();

  const setHandler = (method, path, fn) => {
    handlers.set(`${method.toUpperCase()}:${path}`, fn);
  };

  // Built-in defaults
  setHandler('GET', '/v1/preload/:number', (req, res) => {
    res.status(200).json({});
  });
  setHandler('POST', '/v1/getPhoneNumberByDtfm', (req, res) => {
    res.status(200).json({success: true, phone_number: '+15551234567'});
  });

  // Dynamic router: check handlers map with exact match first, then pattern
  app.use((req, res, next) => {
    const key = `${req.method}:${req.path}`;
    if (handlers.has(key)) {
      return handlers.get(key)(req, res, next);
    }
    // Try pattern-style keys (simple prefix match for parameterised routes)
    for (const [hkey, fn] of handlers.entries()) {
      const [hmethod, hpath] = hkey.split(':');
      if (hmethod !== req.method) continue;
      // Convert :param segments to regex
      const pattern = new RegExp('^' + hpath.replace(/:[^/]+/g, '[^/]+') + '$');
      if (pattern.test(req.path)) {
        return fn(req, res, next);
      }
    }
    next();
  });

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const close = async() => {
    await new Promise((resolve) => server.close(resolve));
  };

  return {baseUrl, requests, setHandler, close};
}

module.exports = {startFakeUpstream};
