'use strict';

const {startApp, fakeJambonzClient} = require('./helpers');
const request = require('supertest');

jest.setTimeout(10000);

// Poll ongoingSessions until the sid appears or timeout elapses.
function waitForSession(ongoingSessions, sid, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (ongoingSessions.has(sid)) return resolve(ongoingSessions.get(sid));
      if (Date.now() >= deadline) return reject(new Error(`session ${sid} not found after ${timeoutMs}ms`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

// Helper to connect a fake jambonz client and get a live session in ongoingSessions.
async function createLiveSession(baseWsUrl, ongoingSessions, sessionData = {}) {
  const client = fakeJambonzClient(baseWsUrl, {path: '/proxy-vapi', sessionData});
  await client.connect();
  client.sendSessionNew();
  // Wait until the server's session:new handler has registered the session.
  const session = await waitForSession(ongoingSessions, client.call_sid);
  // Yield to let the server finish sending the ack frame before we proceed.
  await new Promise((r) => setImmediate(r));
  return {client, session};
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PUT /calls/:sid — update-call integration', () => {
  let ctx;

  beforeAll(async() => {
    ctx = await startApp();
  });

  afterAll(async() => {
    await ctx.close();
  });

  // ── (a) callerId update ──────────────────────────────────────────────────────

  describe('(a) known sid + callerId body', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('returns 200 {status:"ok"} and mutates session.locals.currentCallerId', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: '+19998887777'});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
      expect(session.locals.currentCallerId).toBe('+19998887777');
    }, 5000);

    test('callerId value is set to the exact string sent — not truthy-coerced', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: '+10000000001'});

      expect(res.status).toBe(200);
      expect(session.locals.currentCallerId).toBe('+10000000001');
    }, 5000);
  });

  // ── (b) recordAction — wire frame ────────────────────────────────────────────

  describe('(b) known sid + recordAction body', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('returns 200 {status:"ok"} and fake client receives {type:"command",command:"record"} frame', async() => {
      const {client: c} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      // Await the HTTP PUT first — sendCommand is called before res.json(), so by the
      // time we receive the 200, the frame has already been sent over the wire.
      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({recordAction: 'startCallRecording'});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});

      // The frame must have arrived by now (sent before HTTP handler returned); use
      // waitFor with a short timeout to handle any residual TCP latency.
      const frame = await client.waitFor(
        (f) => f.type === 'command' && f.command === 'record',
        {timeoutMs: 1000}
      );

      // Wire frame assertions — exact shape from session.sendCommand
      expect(frame.type).toBe('command');
      expect(frame.command).toBe('record');
      expect(frame.data).toStrictEqual({action: 'startCallRecording'});
      // queueCommand is hardcoded to false in sendCommand
      expect(frame.queueCommand).toBe(false);
    }, 5000);

    test('record frame data.action matches the exact recordAction string sent', async() => {
      const {client: c} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({recordAction: 'stopCallRecording'});

      const frame = await client.waitFor(
        (f) => f.type === 'command' && f.command === 'record',
        {timeoutMs: 1000}
      );

      expect(frame.data).toStrictEqual({action: 'stopCallRecording'});
    }, 5000);
  });

  // ── (c) Unknown sid → 404 ────────────────────────────────────────────────────

  describe('(c) unknown sid → 404', () => {
    test('returns 404 {error:"Call not found"} for a random uuid not in ongoingSessions', async() => {
      const unknownSid = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
      // Verify it really is not in the map.
      expect(ctx.ongoingSessions.has(unknownSid)).toBe(false);

      const res = await request(ctx.app)
        .put('/calls/' + unknownSid)
        .send({callerId: '+19998887777'});

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual({error: 'Call not found'});
    }, 5000);

    test('unknown sid with recordAction body also returns 404', async() => {
      const unknownSid = 'ffffffff-ffff-ffff-ffff-000000000000';

      const res = await request(ctx.app)
        .put('/calls/' + unknownSid)
        .send({recordAction: 'startCallRecording'});

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual({error: 'Call not found'});
    }, 5000);
  });

  // ── Edge: empty body ─────────────────────────────────────────────────────────

  describe('edge: empty body on known sid', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('returns 200 {status:"ok"} and does NOT mutate currentCallerId when body is empty {}', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;
      // proxy-vapi sets currentCallerId to session.from on session:new
      const initialCallerId = session.locals.currentCallerId;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
      // Neither callerId nor recordAction provided — should be unchanged
      expect(session.locals.currentCallerId).toBe(initialCallerId);
    }, 5000);

    test('returns 200 and does NOT crash when body has no content-type (no body sent)', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid);

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
    }, 5000);
  });

  // ── Edge: both callerId and recordAction present ─────────────────────────────

  describe('edge: both callerId and recordAction in one request', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('mutates currentCallerId AND sends record command frame when both fields present', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: '+12223334444', recordAction: 'startCallRecording'});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
      // callerId mutation
      expect(session.locals.currentCallerId).toBe('+12223334444');

      // record frame must arrive
      const frame = await client.waitFor(
        (f) => f.type === 'command' && f.command === 'record',
        {timeoutMs: 1000}
      );
      expect(frame.command).toBe('record');
      expect(frame.data).toStrictEqual({action: 'startCallRecording'});
    }, 5000);
  });

  // ── Edge: wrong HTTP method → Express 404/405 ───────────────────────────────

  describe('edge: wrong HTTP method', () => {
    test('POST /calls/:sid returns non-200 (route is PUT-only)', async() => {
      const res = await request(ctx.app)
        .post('/calls/some-sid')
        .send({callerId: '+19998887777'});

      expect(res.status).not.toBe(200);
    }, 5000);
  });

  // ── Edge: callerId set to empty string — falsy, should NOT mutate ────────────

  describe('edge: callerId is empty string (falsy)', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('does NOT mutate currentCallerId when callerId is "" (falsy)', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;
      const initialCallerId = session.locals.currentCallerId;

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: ''});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
      // '' is falsy — route uses `if (callerId)` so it skips the mutation
      expect(session.locals.currentCallerId).toBe(initialCallerId);
    }, 5000);
  });

  // ── Edge: multiple sequential callerId updates on same session ───────────────

  describe('edge: repeated callerId updates (idempotency / last-write-wins)', () => {
    let client;

    afterEach(async() => {
      if (client) {
        await client.close();
        client = null;
      }
    });

    test('last PUT wins — currentCallerId reflects the most recent callerId', async() => {
      const {client: c, session} = await createLiveSession(ctx.baseWsUrl, ctx.ongoingSessions);
      client = c;

      await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: '+11111111111'});

      expect(session.locals.currentCallerId).toBe('+11111111111');

      const res = await request(ctx.app)
        .put('/calls/' + client.call_sid)
        .send({callerId: '+12222222222'});

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({status: 'ok'});
      expect(session.locals.currentCallerId).toBe('+12222222222');
    }, 5000);
  });
});
