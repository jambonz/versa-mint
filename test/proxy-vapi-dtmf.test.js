'use strict';

const {startApp, fakeJambonzClient, startFakeUpstream} = require('./helpers');

jest.setTimeout(10000);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** find the first ack frame whose verb array contains a verb with the given name */
function findAckWithVerb(frames, verbName) {
  return frames.find(
    (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === verbName)
  );
}

/** wait for an ack frame that contains a specific verb */
function waitForAckWithVerb(client, verbName) {
  return client.waitFor(
    (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === verbName),
    {timeoutMs: 2500}
  );
}

/** pull a single verb object out of an ack frame */
function pickVerb(frame, verbName) {
  return frame.data.find((v) => v.verb === verbName);
}

// ---------------------------------------------------------------------------
// Suite A — session:new initial ack (answer + gather)
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: session:new', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('first ack contains answer verb', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    expect(frame.type).toBe('ack');
    expect(Array.isArray(frame.data)).toBe(true);
    const answerVerb = frame.data.find((v) => v.verb === 'answer');
    expect(answerVerb).not.toBeUndefined();
    expect(answerVerb.verb).toBe('answer');
  }, 5000);

  test('first ack contains gather verb with exact actionHook /codeGather', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const gatherVerb = pickVerb(frame, 'gather');
    expect(gatherVerb).not.toBeUndefined();
    expect(gatherVerb.actionHook).toBe('/codeGather');
  }, 5000);

  test('gather verb has numDigits === 4', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const gatherVerb = pickVerb(frame, 'gather');
    expect(gatherVerb).not.toBeUndefined();
    expect(gatherVerb.numDigits).toBe(4);
  }, 5000);

  test('gather verb input contains digits', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const gatherVerb = pickVerb(frame, 'gather');
    expect(gatherVerb).not.toBeUndefined();
    expect(Array.isArray(gatherVerb.input)).toBe(true);
    expect(gatherVerb.input).toContain('digits');
  }, 5000);

  test('gather verb has timeout === 15', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const gatherVerb = pickVerb(frame, 'gather');
    expect(gatherVerb.timeout).toBe(15);
  }, 5000);

  test('first ack has answer before gather (order preserved)', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const verbs = frame.data.map((v) => v.verb);
    const answerIdx = verbs.indexOf('answer');
    const gatherIdx = verbs.indexOf('gather');
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(gatherIdx).toBeGreaterThan(answerIdx);
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite B — Happy path: dtmfDetected with valid digits => dial
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: /codeGather happy path', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {
      path: '/proxy-vapi-dtmf',
      sessionData: {from: '+15550001111', to: '+15550002222'}
    });
    await client.connect();
    // Establish session and consume initial gather ack
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('dtmfDetected digits replies with dial verb', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb).not.toBeUndefined();
    expect(dialVerb.verb).toBe('dial');
  }, 5000);

  test('dial callerId equals phone_number from upstream response', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    // upstream default returns +15551234567
    expect(dialVerb.callerId).toBe('+15551234567');
  }, 5000);

  test('dial target[0].number equals session.to', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    expect(Array.isArray(dialVerb.target)).toBe(true);
    expect(dialVerb.target.length).toBeGreaterThanOrEqual(1);
    expect(dialVerb.target[0].number).toBe('+15550002222');
    expect(dialVerb.target[0].type).toBe('phone');
  }, 5000);

  test('dial has answerOnBridge true and anchorMedia true', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb.answerOnBridge).toBe(true);
    expect(dialVerb.anchorMedia).toBe(true);
  }, 5000);

  test('dial has actionHook /dialAction and referHook /dialRefer', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb.actionHook).toBe('/dialAction');
    expect(dialVerb.referHook).toBe('/dialRefer');
  }, 5000);

  test('upstream received exactly one POST to /v1/getPhoneNumberByDtfm', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    await waitForAckWithVerb(client, 'dial');
    const lookupReqs = upstream.requests.filter(
      (r) => r.method === 'POST' && r.path === '/v1/getPhoneNumberByDtfm'
    );
    expect(lookupReqs.length).toBe(1);
  }, 5000);

  test('upstream lookup request body has {code: "1234"}', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    await waitForAckWithVerb(client, 'dial');
    const lookupReq = upstream.requests.find(
      (r) => r.method === 'POST' && r.path === '/v1/getPhoneNumberByDtfm'
    );
    expect(lookupReq).not.toBeUndefined();
    expect(lookupReq.body).toEqual({code: '1234'});
  }, 5000);

  test('upstream lookup request header x-api-key === "test-key"', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    await waitForAckWithVerb(client, 'dial');
    const lookupReq = upstream.requests.find(
      (r) => r.method === 'POST' && r.path === '/v1/getPhoneNumberByDtfm'
    );
    expect(lookupReq).not.toBeUndefined();
    expect(lookupReq.headers['x-api-key']).toBe('test-key');
  }, 5000);

  test('dial headers carry X-phone-number from upstream response', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'dial');
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb.headers['X-phone-number']).toBe('+15551234567');
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite C — Lookup failure: success:false with error_message => hangup
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: /codeGather lookup failure (success:false)', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    // Override default handler to return failure
    upstream.setHandler('post', '/v1/getPhoneNumberByDtfm', (req, res) => {
      res.status(200).json({success: false, error_message: 'bad code'});
    });
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('replies with hangup verb when success is false', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '9999'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb).not.toBeUndefined();
    expect(hangupVerb.verb).toBe('hangup');
  }, 5000);

  test('hangup X-Reason header carries error_message "bad code"', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '9999'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers).toBeDefined();
    expect(hangupVerb.headers['X-Reason']).toBe('bad code');
  }, 5000);

  test('no dial verb is present in failure frame', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '9999'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb).toBeUndefined();
  }, 5000);

  test('failure with missing error_message falls back to "Invalid code"', async() => {
    // Override to return success:false without error_message
    upstream.setHandler('post', '/v1/getPhoneNumberByDtfm', (req, res) => {
      res.status(200).json({success: false});
    });
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '0000'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('Invalid code');
  }, 5000);

  test('failure with success:true but missing phone_number => hangup with "Invalid code"', async() => {
    upstream.setHandler('post', '/v1/getPhoneNumberByDtfm', (req, res) => {
      res.status(200).json({success: true}); // no phone_number
    });
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1111'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('Invalid code');
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite D — No code: reason !== 'dtmfDetected' => hangup "No code provided"
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: /codeGather no-code paths', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('timeout reason replies with hangup', async() => {
    client.sendHook('/codeGather', {reason: 'timeout'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb).not.toBeUndefined();
    expect(hangupVerb.verb).toBe('hangup');
  }, 5000);

  test('timeout reason hangup X-Reason === "No code provided"', async() => {
    client.sendHook('/codeGather', {reason: 'timeout'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('No code provided');
  }, 5000);

  test('dtmfDetected with empty digits string => hangup "No code provided"', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: ''});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('No code provided');
  }, 5000);

  test('dtmfDetected with no digits key => hangup "No code provided"', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('No code provided');
  }, 5000);

  test('random non-dtmfDetected reason => hangup "No code provided"', async() => {
    client.sendHook('/codeGather', {reason: 'bargein'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('No code provided');
  }, 5000);

  test('no upstream lookup occurs on timeout reason', async() => {
    client.sendHook('/codeGather', {reason: 'timeout'});
    await waitForAckWithVerb(client, 'hangup');
    const lookupReqs = upstream.requests.filter(
      (r) => r.path === '/v1/getPhoneNumberByDtfm'
    );
    expect(lookupReqs.length).toBe(0);
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite E — Upstream HTTP 500 => try/catch => hangup "Code lookup error"
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: /codeGather upstream HTTP 500', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    upstream.setHandler('post', '/v1/getPhoneNumberByDtfm', (req, res) => {
      res.status(500).send('Internal Server Error');
    });
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('HTTP 500 response body is not JSON — JSON parse throws — catch yields hangup', async() => {
    // 500 + non-JSON body => response.json() throws, landing in catch block
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb).not.toBeUndefined();
    expect(hangupVerb.verb).toBe('hangup');
  }, 5000);

  test('catch-path hangup X-Reason === "Code lookup error"', async() => {
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '1234'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb.headers['X-Reason']).toBe('Code lookup error');
  }, 5000);

  test('HTTP 500 with JSON body (success:false) takes failure branch not catch — hangup with body.error_message or "Invalid code"', async() => {
    // When the 500 body IS parseable JSON but success:false, response.ok is false
    // so it takes the !response.ok branch (not catch). X-Reason should be error_message or "Invalid code"
    upstream.setHandler('post', '/v1/getPhoneNumberByDtfm', (req, res) => {
      res.status(500).json({success: false, error_message: '500 with json'});
    });
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '5555'});
    const frame = await waitForAckWithVerb(client, 'hangup');
    const hangupVerb = pickVerb(frame, 'hangup');
    expect(hangupVerb).not.toBeUndefined();
    // Either the error_message or fallback "Invalid code" — both are valid per source
    expect(['500 with json', 'Invalid code']).toContain(hangupVerb.headers['X-Reason']);
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite F — dialRefer handler: x_reset and x_dest cases
//
// Design note: dialRefer hooks are sent DIRECTLY after session:new + initial
// gather ack, WITHOUT going through the codeGather/dial cycle. The handlers
// are registered at session:new time, so they fire on any matching hook.
// We must wait for a frame at index > N (frames already received at send time)
// to avoid matching the already-cached gather ack.
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: /dialRefer reset and x_dest', () => {
  let upstream, ctx, client;

  /**
   * Wait for a NEW frame (index > snapshotLen) matching predicate.
   * This prevents waitFor from returning an already-cached ack.
   */
  function waitForNewFrame(snapshotLen, predicate) {
    return client.waitFor(
      (f) => {
        const idx = client.received.indexOf(f);
        return idx >= snapshotLen && predicate(f);
      },
      {timeoutMs: 2500}
    );
  }

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {
      path: '/proxy-vapi-dtmf',
      sessionData: {from: '+15550001111', to: '+15550002222'}
    });
    await client.connect();
    // Only advance to initial gather ack; leave dialRefer tests to fire hooks directly
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('dialRefer with x_reset => replies with dial verb (reset path)', async() => {
    const snapLen = client.received.length;
    client.sendHook('/dialRefer', {
      refer_details: {
        refer_to_user: 'sip:+15559998888@example.com',
        x_reset: 'true',
        x_caller_id: '+15551112222'
      }
    });
    const frame = await waitForNewFrame(
      snapLen,
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial')
    );
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb).not.toBeUndefined();
    expect(dialVerb.verb).toBe('dial');
    expect(dialVerb.anchorMedia).toBe(true);
  }, 5000);

  test('dialRefer with x_reset sets callerId from x_caller_id', async() => {
    const snapLen = client.received.length;
    client.sendHook('/dialRefer', {
      refer_details: {
        refer_to_user: 'sip:+15559998888@example.com',
        x_reset: 'true',
        x_caller_id: '+15551112222'
      }
    });
    const frame = await waitForNewFrame(
      snapLen,
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial')
    );
    const dialVerb = pickVerb(frame, 'dial');
    // x_reset path: callerId set from x_caller_id via session.locals.currentCallerId
    expect(dialVerb.callerId).toBe('+15551112222');
  }, 5000);

  test('dialRefer with x_dest => replies with dial verb targeting sip uri', async() => {
    const snapLen = client.received.length;
    client.sendHook('/dialRefer', {
      refer_details: {
        refer_to_user: 'sip:+15559998888@example.com',
        x_dest: 'sip:+15553334444@pbx.example.com',
        x_caller_id: '+15551234567'
      }
    });
    const frame = await waitForNewFrame(
      snapLen,
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'dial')
    );
    const dialVerb = pickVerb(frame, 'dial');
    expect(dialVerb).not.toBeUndefined();
    expect(dialVerb.verb).toBe('dial');
    expect(dialVerb.target[0].type).toBe('sip');
    expect(dialVerb.target[0].sipUri).toBe('sip:+15553334444@pbx.example.com');
  }, 5000);

  test('dialRefer without x_reset or x_dest => sip:refer verb', async() => {
    // Note: jambonz session.addVerb replaces first '_' with ':' so 'sip_refer' -> 'sip:refer'
    const snapLen = client.received.length;
    client.sendHook('/dialRefer', {
      refer_details: {
        refer_to_user: 'sip:+15559998888@example.com'
      }
    });
    const frame = await waitForNewFrame(
      snapLen,
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:refer')
    );
    const sipReferVerb = frame.data.find((v) => v.verb === 'sip:refer');
    expect(sipReferVerb).not.toBeUndefined();
    expect(sipReferVerb.verb).toBe('sip:refer');
    expect(sipReferVerb.referTo).toBe('sip:+15559998888@example.com');
    expect(sipReferVerb.actionHook).toBe('/sipReferAction');
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite G — API key isolation: different key is forwarded correctly
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: VERSA_API_KEY forwarded correctly', () => {
  let upstream, ctx, client;

  afterEach(async() => {
    if (client) await client.close();
    if (ctx) await ctx.close();
    if (upstream) await upstream.close();
  });

  test('custom api key is sent as x-api-key header to upstream', async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'my-secret-key-xyz'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    client.sendHook('/codeGather', {reason: 'dtmfDetected', digits: '4321'});
    await waitForAckWithVerb(client, 'dial');
    const lookupReq = upstream.requests.find(
      (r) => r.method === 'POST' && r.path === '/v1/getPhoneNumberByDtfm'
    );
    expect(lookupReq).not.toBeUndefined();
    expect(lookupReq.headers['x-api-key']).toBe('my-secret-key-xyz');
  }, 5000);
});

// ---------------------------------------------------------------------------
// Suite H — Teardown / resource leak: multiple sequential sessions
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: sequential sessions do not leak state', () => {
  let upstream, ctx;

  beforeAll(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
  });

  afterAll(async() => {
    await ctx.close();
    await upstream.close();
  });

  test('second session after first session independently gets answer+gather', async() => {
    const c1 = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await c1.connect();
    c1.sendSessionNew();
    const f1 = await c1.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    await c1.close();

    const c2 = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await c2.connect();
    c2.sendSessionNew();
    const f2 = await c2.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    await c2.close();

    // Both sessions should independently get gather verbs
    const g1 = pickVerb(f1, 'gather');
    const g2 = pickVerb(f2, 'gather');
    expect(g1).not.toBeUndefined();
    expect(g2).not.toBeUndefined();
    expect(g1.numDigits).toBe(4);
    expect(g2.numDigits).toBe(4);
    // call_sids should be different
    expect(c1.call_sid).not.toBe(c2.call_sid);
  }, 8000);
});
