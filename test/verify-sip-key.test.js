'use strict';

const {startApp, fakeJambonzClient, startFakeUpstream} = require('./helpers');

jest.setTimeout(10000);

// The expected secret value; matches what we pass as X_VERSA_SIP_KEY env var.
const SIP_KEY = 'super-secret-sip-key-value';

// ---------------------------------------------------------------------------
// Unit tests — verifySipKey() pure logic
// ---------------------------------------------------------------------------

describe('verifySipKey (unit)', () => {
  let verifySipKey;
  const ORIGINAL = process.env.X_VERSA_SIP_KEY;

  beforeEach(() => {
    jest.resetModules();
    ({verifySipKey} = require('../lib/routes/utils'));
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.X_VERSA_SIP_KEY;
    else process.env.X_VERSA_SIP_KEY = ORIGINAL;
  });

  const sessionWith = (headers) => ({sip: {headers}});

  test('returns true (check disabled) when X_VERSA_SIP_KEY is not set', () => {
    delete process.env.X_VERSA_SIP_KEY;
    expect(verifySipKey(sessionWith({'x-versa-sip-key': 'anything'}))).toBe(true);
  });

  test('returns true (check disabled) when X_VERSA_SIP_KEY is empty/whitespace', () => {
    process.env.X_VERSA_SIP_KEY = '   ';
    expect(verifySipKey(sessionWith({}))).toBe(true);
    process.env.X_VERSA_SIP_KEY = '';
    expect(verifySipKey(sessionWith({}))).toBe(true);
  });

  test('returns true when header matches the configured value', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({'x-versa-sip-key': SIP_KEY}))).toBe(true);
  });

  test('returns true when header arrives as a repeated (array) value', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({'x-versa-sip-key': [SIP_KEY, SIP_KEY]}))).toBe(true);
  });

  test('matches header name case-insensitively (e.g. X-versa-sip-key from the INVITE)', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({'X-versa-sip-key': SIP_KEY}))).toBe(true);
    expect(verifySipKey(sessionWith({'X-Versa-Sip-Key': SIP_KEY}))).toBe(true);
  });

  test('returns false when header is missing', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({}))).toBe(false);
  });

  test('returns false when header value is wrong', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({'x-versa-sip-key': 'wrong'}))).toBe(false);
  });

  test('returns false when sip headers are entirely absent', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey({})).toBe(false);
  });

  test('does not throw when session is null/undefined and key is set', () => {
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(null)).toBe(false);
    expect(verifySipKey(undefined)).toBe(false);
  });

  test('accepts an optional logger: warn when disabled, info when rejected', () => {
    const logger = {info: jest.fn(), warn: jest.fn()};
    delete process.env.X_VERSA_SIP_KEY;
    expect(verifySipKey(sessionWith({}), logger)).toBe(true);
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    expect(verifySipKey(sessionWith({}), logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  test('does not log the secret value on rejection', () => {
    const logger = {info: jest.fn(), warn: jest.fn()};
    process.env.X_VERSA_SIP_KEY = SIP_KEY;
    verifySipKey(sessionWith({'x-versa-sip-key': 'attacker-guess'}), logger);
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain(SIP_KEY);
    expect(logged).not.toContain('attacker-guess');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — route declines a call missing/invalid header
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: x-versa-sip-key guard (integration)', () => {
  let upstream, ctx;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    ctx = await startApp({
      env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key', X_VERSA_SIP_KEY: SIP_KEY}
    });
  });

  afterEach(async() => {
    await ctx.close();
    await upstream.close();
  });

  const connect = async(sip) => {
    const client = fakeJambonzClient(ctx.baseWsUrl, {
      path: '/proxy-vapi-dtmf',
      sessionData: sip ? {sip} : {}
    });
    await client.connect();
    return client;
  };

  test('valid header => proceeds with answer+gather (no decline)', async() => {
    const client = await connect({headers: {'x-versa-sip-key': SIP_KEY}});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
      const verbs = frame.data.map((v) => v.verb);
      expect(verbs).toContain('answer');
      expect(verbs).toContain('gather');
      expect(verbs).not.toContain('sip:decline');
    } finally {
      await client.close();
    }
  }, 6000);

  test('missing header => sip:decline 403', async() => {
    const client = await connect(undefined);
    try {
      client.sendSessionNew();
      const frame = await client.waitFor(
        (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
        {timeoutMs: 2500}
      );
      const decline = frame.data.find((v) => v.verb === 'sip:decline');
      expect(decline).not.toBeUndefined();
      expect(decline.status).toBe(403);
      expect(decline.headers['X-Reason']).toBe('Invalid or missing credentials');
      // the call is dropped: no answer/gather verbs were emitted
      expect(frame.data.some((v) => v.verb === 'answer')).toBe(false);
    } finally {
      await client.close();
    }
  }, 6000);

  test('wrong header value => sip:decline 403', async() => {
    const client = await connect({headers: {'x-versa-sip-key': 'not-the-key'}});
    try {
      client.sendSessionNew();
      const frame = await client.waitFor(
        (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
        {timeoutMs: 2500}
      );
      const decline = frame.data.find((v) => v.verb === 'sip:decline');
      expect(decline.status).toBe(403);
    } finally {
      await client.close();
    }
  }, 6000);

  test('no upstream lookup occurs when the call is declined', async() => {
    const client = await connect(undefined);
    try {
      client.sendSessionNew();
      await client.waitFor(
        (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
        {timeoutMs: 2500}
      );
      const lookups = upstream.requests.filter((r) => r.path === '/v1/getPhoneNumberByDtfm');
      expect(lookups.length).toBe(0);
    } finally {
      await client.close();
    }
  }, 6000);
});

// ---------------------------------------------------------------------------
// Integration — when X_VERSA_SIP_KEY is unset the guard is disabled
// ---------------------------------------------------------------------------

describe('proxy-vapi-dtmf: guard disabled when X_VERSA_SIP_KEY unset', () => {
  let upstream, ctx, client;

  beforeEach(async() => {
    upstream = await startFakeUpstream();
    // Note: X_VERSA_SIP_KEY intentionally NOT passed
    ctx = await startApp({env: {VERSA_BASE_URL: upstream.baseUrl, VERSA_API_KEY: 'test-key'}});
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/proxy-vapi-dtmf'});
    await client.connect();
  });

  afterEach(async() => {
    await client.close();
    await ctx.close();
    await upstream.close();
  });

  test('call with no header still proceeds with answer+gather', async() => {
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('answer');
    expect(verbs).toContain('gather');
    expect(verbs).not.toContain('sip:decline');
  }, 6000);
});

// ---------------------------------------------------------------------------
// Integration — proxy-vapi route shares the same guard (no copy-paste drift)
// ---------------------------------------------------------------------------

describe('proxy-vapi: x-versa-sip-key guard (integration)', () => {
  let ctx, client;

  beforeEach(async() => {
    ctx = await startApp({env: {X_VERSA_SIP_KEY: SIP_KEY}});
  });

  afterEach(async() => {
    if (client) await client.close();
    await ctx.close();
  });

  const connect = async(sip) => {
    client = fakeJambonzClient(ctx.baseWsUrl, {
      path: '/proxy-vapi',
      sessionData: sip ? {sip} : {}
    });
    await client.connect();
    return client;
  };

  test('valid header => proceeds with dial (no decline)', async() => {
    await connect({headers: {'x-versa-sip-key': SIP_KEY}});
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('dial');
    expect(verbs).not.toContain('sip:decline');
  }, 6000);

  test('missing header => sip:decline 403', async() => {
    await connect(undefined);
    client.sendSessionNew();
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
      {timeoutMs: 2500}
    );
    const decline = frame.data.find((v) => v.verb === 'sip:decline');
    expect(decline.status).toBe(403);
    expect(frame.data.some((v) => v.verb === 'dial')).toBe(false);
  }, 6000);
});

// ---------------------------------------------------------------------------
// Integration — dial-test-mint route is also guarded
// ---------------------------------------------------------------------------

describe('dial-test-mint: x-versa-sip-key guard (integration)', () => {
  let ctx, client;

  beforeEach(async() => {
    ctx = await startApp({env: {X_VERSA_SIP_KEY: SIP_KEY}});
  });

  afterEach(async() => {
    if (client) await client.close();
    await ctx.close();
  });

  test('missing header => sip:decline 403, no outbound dial', async() => {
    client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
    await client.connect();
    client.sendSessionNew();
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
      {timeoutMs: 2500}
    );
    const decline = frame.data.find((v) => v.verb === 'sip:decline');
    expect(decline.status).toBe(403);
    expect(frame.data.some((v) => v.verb === 'dial')).toBe(false);
  }, 6000);

  test('valid header => proceeds with dial', async() => {
    client = fakeJambonzClient(ctx.baseWsUrl, {
      path: '/dial-test-mint',
      sessionData: {sip: {headers: {'x-versa-sip-key': SIP_KEY}}}
    });
    await client.connect();
    client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 2500});
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('dial');
    expect(verbs).not.toContain('sip:decline');
  }, 6000);
});
