'use strict';

const request = require('supertest');
const {startApp, fakeJambonzClient} = require('./helpers');

jest.setTimeout(10000);

const TIMEOUT = 2500;

function pickVerb(frame, verbName) {
  return frame.data.find((v) => v.verb === verbName);
}

async function connectClient(ctx, sessionData) {
  const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/sip-error', sessionData});
  await client.connect();
  return client;
}

describe('GET /sip-errors', () => {
  let ctx;

  beforeAll(async() => {
    ctx = await startApp();
  });

  afterAll(async() => {
    await ctx.close();
  });

  test('returns the SIP and upstream catalogs', async() => {
    const res = await request(ctx.app).get('/sip-errors');
    expect(res.status).toBe(200);
    expect(res.body.connect.dtmf).toBe('200');
    expect(res.body.connectThenFail).toEqual({
      dtmf: '920',
      action: 'answer-then-hangup',
      description: 'Answer inbound (SIP 200) then hang up as VAPI failed so the caller sees 200 + BYE'
    });
    expect(res.body.sip.some((e) => e.status === 401 && e.reason === 'Unauthorized')).toBe(true);
    expect(res.body.sip.some((e) => e.status === 301 && e.reason === 'Moved Permanently')).toBe(true);
    expect(res.body.sip.some((e) => e.status === 608 && e.reason === 'Rejected')).toBe(true);
    expect(res.body.upstream.some((e) => e.dtmf === '900' && e.status === 502)).toBe(true);
  });
});

describe('sip-error: session:new declines immediately without gather', () => {
  let ctx, client;

  beforeEach(async() => {
    ctx = await startApp();
    client = await connectClient(ctx);
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
  });

  test('DID with a long To user acts immediately — no gather', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).not.toContain('gather');
    if (verbs.includes('answer')) {
      expect(verbs).toContain('hangup');
      expect(verbs).not.toContain('sip:decline');
      expect(pickVerb(frame, 'hangup').headers['X-Reason']).toBe('VAPI failed');
    } else {
      expect(verbs).toContain('sip:decline');
      expect(verbs).not.toContain('answer');
      const decline = pickVerb(frame, 'sip:decline');
      expect(decline.status).toBeGreaterThanOrEqual(300);
      expect(decline.reason).toBeTruthy();
    }
  });
});

describe('sip-error: DTMF maps to sip:decline', () => {
  let ctx, client;

  beforeEach(async() => {
    ctx = await startApp();
    client = await connectClient(ctx);
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
  });

  test('401 returns Unauthorized', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '401'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(401);
    expect(decline.reason).toBe('Unauthorized');
    expect(decline.headers['X-Reason']).toBe('Jambonz unauthorized');
    expect(decline.headers['X-Error-Source']).toBe('sip');
    expect(decline.headers['X-Dtmf-Code']).toBe('401');
    const hangup = pickVerb(frame, 'hangup');
    expect(hangup.headers['X-Reason']).toBe('Jambonz unauthorized');
  });

  test('already-answered gather hangs up instead of sip:decline', async() => {
    const msgid = client.sendHook('/codeGather', {
      reason: 'dtmfDetected',
      digits: '401',
      sip_status: 200,
      call_status: 'in-progress'
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('hangup');
    expect(verbs).not.toContain('sip:decline');
    expect(pickVerb(frame, 'hangup').headers['X-Reason']).toBe('Jambonz unauthorized');
  });

  test.each([
    ['403', 403, 'Forbidden'],
    ['404', 404, 'Not Found'],
    ['480', 480, 'Temporarily Unavailable'],
    ['486', 486, 'Busy Here'],
    ['500', 500, 'Server Internal Error'],
    ['503', 503, 'Service Unavailable'],
    ['603', 603, 'Decline'],
    ['301', 301, 'Moved Permanently'],
    ['607', 607, 'Unwanted'],
    ['608', 608, 'Rejected'],
    ['902', 407, 'Proxy Authentication Required']
  ])('DTMF %s declines with %i %s', async(digits, status, reason) => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(status);
    expect(decline.reason).toBe(reason);
  });

  test('920 answers then hangs up as VAPI failed', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '920'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('answer');
    expect(verbs).toContain('hangup');
    expect(verbs).not.toContain('sip:decline');
    expect(pickVerb(frame, 'hangup').headers).toEqual({
      'X-Reason': 'VAPI failed',
      'X-Error-Source': 'vapi',
      'X-Dtmf-Code': '920'
    });
  });

  test('900 (VAPI failed) declines as 502 with upstream source', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '900'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(502);
    expect(decline.reason).toBe('Bad Gateway');
    expect(decline.headers['X-Reason']).toBe('VAPI failed');
    expect(decline.headers['X-Error-Source']).toBe('upstream');
  });

  test('unknown code declines as 400', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '111'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(400);
    expect(decline.headers['X-Reason']).toBe('Unknown error code');
  });

  test('no digits declines as 408', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'timeout', digits: ''});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(408);
    expect(decline.headers['X-Reason']).toBe('No code provided');
  });
});

describe('sip-error: DTMF 200 connects to VAPI and passes SIP failures back', () => {
  let ctx, client;

  beforeEach(async() => {
    ctx = await startApp({env: {APP_TRUNK_NAME: 'vapi-trunk'}});
    client = await connectClient(ctx);
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
  });

  test('200 dials VAPI with answerOnBridge so a failure can still sip:decline', async() => {
    const msgid = client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '200'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const dial = pickVerb(frame, 'dial');
    expect(dial).toBeDefined();
    expect(dial.answerOnBridge).toBe(true);
    expect(dial.actionHook).toBe('/dialAction');
    expect(dial.target[0]).toEqual({
      type: 'phone',
      number: '+15550002222',
      trunk: 'vapi-trunk'
    });
    expect(frame.data.some((v) => v.verb === 'sip:decline')).toBe(false);
  });

  test('VAPI 401 is remapped to 407 on the inbound SIP connect', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '200'});
    await client.waitFor(
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial'),
      {timeoutMs: TIMEOUT}
    );

    const msgid = client.sendHook('/dialAction', {call_status: 'failed', dial_sip_status: 401});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    const decline = pickVerb(frame, 'sip:decline');
    expect(decline.status).toBe(407);
    expect(decline.reason).toBe('Proxy Authentication Required');
    expect(decline.headers['X-Error-Source']).toBe('vapi');
    expect(decline.headers['X-Reason']).toBe('VAPI Proxy Authentication Required');
  });

  test('VAPI 503 Service Unavailable is passed through', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '200'});
    await client.waitFor(
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial'),
      {timeoutMs: TIMEOUT}
    );

    const msgid = client.sendHook('/dialAction', {call_status: 'failed', dial_sip_status: 503});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    expect(pickVerb(frame, 'sip:decline').status).toBe(503);
  });

  test('completed VAPI call does not sip:decline', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '200'});
    await client.waitFor(
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial'),
      {timeoutMs: TIMEOUT}
    );

    const msgid = client.sendHook('/dialAction', {call_status: 'completed', dial_sip_status: 200});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === msgid,
      {timeoutMs: TIMEOUT}
    );
    expect(frame.data ?? []).toEqual([]);
  });
});

describe('sip-error: INVITE To / header simulates a VAPI that fails immediately', () => {
  let ctx;

  beforeEach(async() => {
    ctx = await startApp({env: {APP_TRUNK_NAME: 'vapi-trunk'}});
  });

  afterEach(async() => {
    await ctx.close();
  });

  test('To=401 is Jambonz unauthorized, not a VAPI failure', async() => {
    const client = await connectClient(ctx, {to: '401'});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      const verbs = frame.data.map((v) => v.verb);
      expect(verbs).toContain('sip:decline');
      expect(verbs).not.toContain('gather');
      const decline = pickVerb(frame, 'sip:decline');
      expect(decline.status).toBe(401);
      expect(decline.headers['X-Reason']).toBe('Jambonz unauthorized');
      expect(decline.headers['X-Error-Source']).toBe('sip');
    } finally {
      await client.close();
    }
  });

  test('To=900 simulates VAPI connect failure as 502', async() => {
    const client = await connectClient(ctx, {to: '900'});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      const decline = pickVerb(frame, 'sip:decline');
      expect(decline.status).toBe(502);
      expect(decline.headers['X-Reason']).toBe('VAPI failed');
      expect(decline.headers['X-Error-Source']).toBe('upstream');
      expect(frame.data.some((v) => v.verb === 'gather')).toBe(false);
    } finally {
      await client.close();
    }
  });

  test('To=902 simulates VAPI unauthorized as 407', async() => {
    const client = await connectClient(ctx, {to: '902'});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      const decline = pickVerb(frame, 'sip:decline');
      expect(decline.status).toBe(407);
      expect(decline.headers['X-Reason']).toBe('VAPI unauthorized');
    } finally {
      await client.close();
    }
  });

  test('X-Simulate-Error: 486 declines Busy Here', async() => {
    const client = await connectClient(ctx, {
      to: '+15550002222',
      sip: {headers: {'X-Simulate-Error': '486'}}
    });
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      const decline = pickVerb(frame, 'sip:decline');
      expect(decline.status).toBe(486);
      expect(decline.reason).toBe('Busy Here');
      expect(frame.data.some((v) => v.verb === 'gather')).toBe(false);
    } finally {
      await client.close();
    }
  });

  test('To=920 answers then hangs up as VAPI failed (200 + BYE)', async() => {
    const client = await connectClient(ctx, {to: '920'});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      const verbs = frame.data.map((v) => v.verb);
      expect(verbs).toContain('answer');
      expect(verbs).toContain('hangup');
      expect(verbs).not.toContain('sip:decline');
      expect(verbs).not.toContain('gather');
      expect(pickVerb(frame, 'hangup').headers['X-Reason']).toBe('VAPI failed');
      expect(pickVerb(frame, 'hangup').headers['X-Error-Source']).toBe('vapi');
    } finally {
      await client.close();
    }
  });

  test('To=200 dials VAPI immediately (fake-VAPI success / real connect)', async() => {
    const client = await connectClient(ctx, {to: '200'});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});
      expect(pickVerb(frame, 'dial')).toBeDefined();
      expect(frame.data.some((v) => v.verb === 'gather')).toBe(false);
    } finally {
      await client.close();
    }
  });
});
