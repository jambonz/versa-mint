'use strict';

const WebSocket = require('ws');
const {startApp, fakeJambonzClient} = require('./helpers');

jest.setTimeout(10000);

// Force-terminate a raw ws instance regardless of its state
function terminateRawWs(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve);
    ws.terminate();
  });
}

// Wrap closeApp() with a hard timeout so the afterAll never hangs.
// server.close() may block indefinitely if @jambonz/node-client-ws holds
// internal references to upgraded sockets even after closeAllConnections().
// We resolve once the server has closed OR after timeoutMs, whichever comes
// first, then --forceExit handles residual handles.
function boundedClose(closeApp, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    closeApp().then(() => {
      clearTimeout(timer);
      resolve();
    }).catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Close a fakeJambonzClient and guarantee the underlying TCP is drained.
// The helper's close() only awaits 'close' event, which may not fire if the
// socket was rejected during upgrade (state stays 'idle' after unexpected-response).
// We use a bounded timeout so this never hangs.
function safeClientClose(client, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(done, timeoutMs);

    client.close().then(() => {
      clearTimeout(timer);
      done();
    }).catch(() => {
      clearTimeout(timer);
      done();
    });
  });
}

// Await a raw WS upgrade attempt with bounded timeout.
// Resolves with {outcome: 'open'|'unexpected-response'|'error'|'close'|'timeout', status?, message?}
function awaitUpgrade(ws, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => {
      ws.terminate();
      settle({outcome: 'timeout'});
    }, timeoutMs);

    ws.once('open', () => {
      ws.close();
      settle({outcome: 'open'});
    });
    ws.once('unexpected-response', (req, res) => {
      // terminate the underlying socket so the TCP handle is freed
      ws.terminate();
      settle({outcome: 'unexpected-response', status: res.statusCode});
    });
    ws.once('error', (err) => {
      ws.terminate();
      settle({outcome: 'error', message: err.message});
    });
    ws.once('close', () => settle({outcome: 'close'}));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: AUTH DISABLED — neither env var set
// ─────────────────────────────────────────────────────────────────────────────
describe('basic-auth: AUTH DISABLED (no env vars)', () => {
  let baseWsUrl;
  let appServer;
  let closeApp;

  beforeAll(async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst = await startApp({env: {}});
    baseWsUrl = appInst.baseWsUrl;
    appServer = appInst.server;
    closeApp = appInst.close;
  }, 12000);

  afterAll(async() => {
    if (appServer && typeof appServer.closeAllConnections === 'function') {
      appServer.closeAllConnections();
    }
    await boundedClose(closeApp);
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
  }, 12000);

  test('no-auth client connects OK when auth disabled', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
    }
  }, 7000);

  test('client with arbitrary creds still connects OK when auth disabled', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'anyone', pass: 'anything'},
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
    }
  }, 7000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: AUTH DISABLED — only HTTP_USERNAME set (HTTP_PASSWORD absent)
// Middleware disables auth unless BOTH vars are set.
// ─────────────────────────────────────────────────────────────────────────────
describe('basic-auth: AUTH DISABLED (only HTTP_USERNAME set)', () => {
  let baseWsUrl;
  let appServer;
  let closeApp;

  beforeAll(async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst = await startApp({env: {HTTP_USERNAME: 'u'}});
    // Belt-and-braces: delete PASSWORD after startApp sets env
    delete process.env.HTTP_PASSWORD;
    baseWsUrl = appInst.baseWsUrl;
    appServer = appInst.server;
    closeApp = appInst.close;
  }, 12000);

  afterAll(async() => {
    if (appServer && typeof appServer.closeAllConnections === 'function') {
      appServer.closeAllConnections();
    }
    await boundedClose(closeApp);
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
  }, 12000);

  test('no-auth client connects OK — one var missing means auth is disabled', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
    }
  }, 7000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: AUTH DISABLED — only HTTP_PASSWORD set (HTTP_USERNAME absent)
// ─────────────────────────────────────────────────────────────────────────────
describe('basic-auth: AUTH DISABLED (only HTTP_PASSWORD set)', () => {
  let baseWsUrl;
  let appServer;
  let closeApp;

  beforeAll(async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst = await startApp({env: {HTTP_PASSWORD: 'p'}});
    delete process.env.HTTP_USERNAME;
    baseWsUrl = appInst.baseWsUrl;
    appServer = appInst.server;
    closeApp = appInst.close;
  }, 12000);

  afterAll(async() => {
    if (appServer && typeof appServer.closeAllConnections === 'function') {
      appServer.closeAllConnections();
    }
    await boundedClose(closeApp);
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
  }, 12000);

  test('no-auth client connects OK — one var missing means auth is disabled', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
    }
  }, 7000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: AUTH PASS — correct credentials
// ─────────────────────────────────────────────────────────────────────────────
describe('basic-auth: AUTH PASS (correct credentials)', () => {
  let baseWsUrl;
  let appServer;
  let closeApp;

  beforeAll(async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst = await startApp({env: {HTTP_USERNAME: 'u', HTTP_PASSWORD: 'p'}});
    baseWsUrl = appInst.baseWsUrl;
    appServer = appInst.server;
    closeApp = appInst.close;
  }, 12000);

  afterAll(async() => {
    if (appServer && typeof appServer.closeAllConnections === 'function') {
      appServer.closeAllConnections();
    }
    await boundedClose(closeApp);
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
  }, 12000);

  test('correct creds — socket opens', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u', pass: 'p'},
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
    }
  }, 7000);

  test('correct creds — sendSessionNew() receives an ack frame', async() => {
    const client = fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u', pass: 'p'},
      connectTimeoutMs: 3000
    });
    try {
      await client.connect();
      expect(client.state).toBe('open');

      const msgid = client.sendSessionNew();
      const ack = await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: 3000});
      expect(typeof ack).toBe('object');
      expect(ack.type).toBe('ack');
      expect(ack.msgid).toBe(msgid);
    } finally {
      await safeClientClose(client);
    }
  }, 9000);

  test('password containing colons — only first colon is the separator — passes', async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst2 = await startApp({env: {HTTP_USERNAME: 'u2', HTTP_PASSWORD: 'p:with:colons'}});
    const client = fakeJambonzClient(appInst2.baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u2', pass: 'p:with:colons'},
      connectTimeoutMs: 3000
    });
    try {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.state).toBe('open');
    } finally {
      await safeClientClose(client);
      if (appInst2.server && typeof appInst2.server.closeAllConnections === 'function') {
        appInst2.server.closeAllConnections();
      }
      await boundedClose(appInst2.close);
    }
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: AUTH FAIL — all rejection cases
// ─────────────────────────────────────────────────────────────────────────────
describe('basic-auth: AUTH FAIL', () => {
  let baseWsUrl;
  let appServer;
  let closeApp;

  beforeAll(async() => {
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
    const appInst = await startApp({env: {HTTP_USERNAME: 'u', HTTP_PASSWORD: 'p'}});
    baseWsUrl = appInst.baseWsUrl;
    appServer = appInst.server;
    closeApp = appInst.close;
  }, 12000);

  afterAll(async() => {
    if (appServer && typeof appServer.closeAllConnections === 'function') {
      appServer.closeAllConnections();
    }
    await boundedClose(closeApp);
    delete process.env.HTTP_USERNAME;
    delete process.env.HTTP_PASSWORD;
  }, 12000);

  // Helper: assert a fakeJambonzClient whose connect() should reject
  const assertRejects = async(client) => {
    try {
      await expect(client.connect()).rejects.toThrow();
      expect(client.state).not.toBe('open');
    } finally {
      await safeClientClose(client);
    }
  };

  test('3a: wrong password — connect() REJECTS, socket never opens', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u', pass: 'WRONG'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('3b: no auth header — connect() REJECTS, socket never opens', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('wrong username correct password — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'WRONG', pass: 'p'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('both credentials wrong — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'x', pass: 'y'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('empty user, correct pass — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: '', pass: 'p'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('correct user, empty pass — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u', pass: ''},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('case-sensitive: UPPER(u) vs stored u — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'U', pass: 'p'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('case-sensitive: correct u, UPPER(P) — connect() REJECTS', async() => {
    await assertRejects(fakeJambonzClient(baseWsUrl, {
      path: '/proxy-vapi',
      auth: {user: 'u', pass: 'P'},
      connectTimeoutMs: 3000
    }));
  }, 6000);

  test('malformed header: Bearer scheme instead of Basic — upgrade rejected', async() => {
    const ws = new WebSocket(baseWsUrl + '/proxy-vapi', 'ws.jambonz.org', {
      headers: {Authorization: 'Bearer some-token'}
    });
    const result = await awaitUpgrade(ws, 3000);
    expect(result.outcome).not.toBe('open');
    if (result.outcome === 'unexpected-response') {
      expect(result.status).toBe(401);
    }
  }, 6000);

  test('no colon in base64-decoded credentials — upgrade rejected', async() => {
    // 'usernameonly' decoded has no colon; middleware rejects with 401 (malformed credentials)
    const malformedBase64 = Buffer.from('usernameonly').toString('base64');
    const ws = new WebSocket(baseWsUrl + '/proxy-vapi', 'ws.jambonz.org', {
      headers: {Authorization: 'Basic ' + malformedBase64}
    });
    const result = await awaitUpgrade(ws, 3000);
    expect(result.outcome).not.toBe('open');
    if (result.outcome === 'unexpected-response') {
      expect(result.status).toBe(401);
    }
  }, 6000);

  test('Basic header with only a colon (empty user and pass) — upgrade rejected', async() => {
    // ':' -> user='', pass='' — both fail safeEqual against 'u'/'p'
    const colonOnly = Buffer.from(':').toString('base64');
    const ws = new WebSocket(baseWsUrl + '/proxy-vapi', 'ws.jambonz.org', {
      headers: {Authorization: 'Basic ' + colonOnly}
    });
    const result = await awaitUpgrade(ws, 3000);
    expect(result.outcome).not.toBe('open');
    if (result.outcome === 'unexpected-response') {
      expect(result.status).toBe(401);
    }
  }, 6000);

  test('Authorization header present but value is empty string — upgrade rejected', async() => {
    const ws = new WebSocket(baseWsUrl + '/proxy-vapi', 'ws.jambonz.org', {
      headers: {Authorization: ''}
    });
    const result = await awaitUpgrade(ws, 3000);
    expect(result.outcome).not.toBe('open');
  }, 6000);

  test('repeated failed attempts in sequence — all rejected, no state bleed', async() => {
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await assertRejects(fakeJambonzClient(baseWsUrl, {
        path: '/proxy-vapi',
        auth: {user: 'u', pass: `wrong-${i}`},
        connectTimeoutMs: 3000
      }));
    }
  }, 9000);
});
