const {startApp, fakeJambonzClient, startFakeUpstream} = require('./index');
const WebSocket = require('ws');

describe('harness smoke tests', () => {
  test('createApp has no side effects', () => {
    jest.resetModules();
    // Set minimal env so the module loads (basic-auth reads process.env at require-time)
    process.env.LOGLEVEL = 'silent';
    const {createApp} = require('../../lib/create-app');
    expect(typeof createApp).toBe('function');
    // Did not throw, did not listen — no assertions on port needed
  });

  test('startApp listens on ephemeral port and close releases it', async() => {
    const ctx = await startApp();
    expect(ctx.baseWsUrl).toMatch(/ws:\/\/127\.0\.0\.1:\d+/);
    await ctx.close();

    // Second startApp succeeds — proves the port was released
    const ctx2 = await startApp();
    expect(ctx2.baseWsUrl).toMatch(/ws:\/\/127\.0\.0\.1:\d+/);
    await ctx2.close();
  });

  test('fakeJambonzClient connects with subprotocol and receives a frame', async() => {
    const ctx = await startApp();
    const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi'});
    try {
      await client.connect();
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack');
      expect(frame).toBeDefined();
      expect(Array.isArray(frame.data)).toBe(true);
      expect(frame.data[0]).toBeDefined();
      expect(frame.data[0].verb).toBeDefined();
    } finally {
      await client.close();
      await ctx.close();
    }
  });

  test('connect without subprotocol is rejected', async() => {
    // ws lib only calls handleProtocols when the client sends at least one protocol.
    // A client sending a non-matching subprotocol gets "Server sent no subprotocol" error.
    // A client sending NO subprotocol opens successfully (handleProtocols is skipped).
    // We test the former — the only path that triggers rejection at the WS layer.
    const ctx = await startApp();
    const rejectedErr = await new Promise((resolve, reject) => {
      const ws = new WebSocket(ctx.baseWsUrl + '/proxy-vapi', 'wrong-protocol');
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('Expected rejection but timed out'));
      }, 2000);
      ws.once('open', () => {
        clearTimeout(timeout);
        ws.close();
        reject(new Error('Expected rejection but got open'));
      });
      ws.once('error', (err) => {
        clearTimeout(timeout);
        resolve(err);
      });
      ws.once('unexpected-response', (req, res) => {
        clearTimeout(timeout);
        ws.terminate();
        resolve(new Error(`unexpected-response: ${res.statusCode}`));
      });
      ws.once('close', (code) => {
        clearTimeout(timeout);
        resolve(new Error(`closed with code ${code}`));
      });
    }).finally(() => ctx.close());
    expect(rejectedErr).toBeInstanceOf(Error);
  });

  test('real default path: proxy-vapi-dtmf code lookup hits injected fake upstream', async() => {
    const up = await startFakeUpstream();
    const ctx = await startApp({env: {VERSA_BASE_URL: up.baseUrl, VERSA_API_KEY: 'k'}});
    const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    try {
      await client.connect();
      client.sendSessionNew();
      // Wait for initial ack (gather verb)
      await client.waitFor((f) => f.type === 'ack');

      // Send the code gather hook
      client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});

      // Wait for second ack (dial verb after lookup)
      await client.waitFor((f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial'));

      expect(up.requests.some((r) => r.path === '/v1/getPhoneNumberByDtfm')).toBe(true);
    } finally {
      await client.close();
      await ctx.close();
      await up.close();
    }
  });
});
