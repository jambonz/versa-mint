'use strict';

const {startApp, fakeJambonzClient} = require('./helpers');

jest.setTimeout(8000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait until predicate is true on received[] (poll-style on the array).
 * Uses client.waitFor internally which already checks existing frames first.
 */
const TIMEOUT = 2500;

// ---------------------------------------------------------------------------
// Shared app instance — each test gets its own fresh client so state doesn't
// bleed between tests (isReferReceived, digitsDelays are per-session).
// ---------------------------------------------------------------------------

let app;

beforeAll(async() => {
  app = await startApp();
});

afterAll(async() => {
  await app.close();
});

// Helper: make a fresh connected client, send session:new, wait for first ack
async function makeConnectedClient(sessionData = {}) {
  const client = fakeJambonzClient(app.baseWsUrl, {
    path: '/proxy-vapi',
    sessionData: {
      from: '+15550001111',
      to: '+15550002222',
      ...sessionData
    }
  });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// (a) session:new -> first ack contains dial verb with correct params
// ---------------------------------------------------------------------------

describe('(a) session:new -> initial dial', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('first ack has verb=dial with trunk, callerId, actionHook, referHook', async() => {
    client = await makeConnectedClient();
    const msgid = client.sendSessionNew();

    const frame = await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(msgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);

    const verb = frame.data[0];
    expect(verb.verb).toBe('dial');
    expect(verb.callerId).toBe('+15550001111');    // from
    expect(verb.actionHook).toBe('/dialAction');
    expect(verb.referHook).toBe('/dialRefer');
    expect(Array.isArray(verb.target)).toBe(true);
    expect(verb.target).toHaveLength(1);
    expect(verb.target[0].trunk).toBe(process.env.APP_TRUNK_NAME || 'test-trunk');
    expect(verb.target[0].type).toBe('phone');
    expect(verb.target[0].number).toBe('+15550002222');   // to
  });

  test('dial has answerOnBridge=true, anchorMedia=true', async() => {
    client = await makeConnectedClient();
    const msgid = client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    const verb = frame.data[0];
    expect(verb.verb).toBe('dial');
    expect(verb.answerOnBridge).toBe(true);
    expect(verb.anchorMedia).toBe(true);
  });

  test('dial headers contain X-original-call-sid equal to call_sid', async() => {
    client = await makeConnectedClient();
    const msgid = client.sendSessionNew();
    const frame = await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    const verb = frame.data[0];
    expect(verb.verb).toBe('dial');
    expect(verb.headers).toBeDefined();
    expect(typeof verb.headers).toBe('object');
    expect(verb.headers['X-original-call-sid']).toBe(client.call_sid);
  });

  test('session is stored in ongoingSessions after session:new', async() => {
    client = await makeConnectedClient();
    const msgid = client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    expect(app.ongoingSessions.has(client.call_sid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) dialAction with call_status='in-progress' -> hangup verb
// ---------------------------------------------------------------------------

describe('(b) /dialAction in-progress -> hangup', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('reply contains hangup verb', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'in-progress'}, 'verb:hook');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(hookMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);
    expect(frame.data[0].verb).toBe('hangup');
  });

  test('hangup verb has X-Reason header', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'in-progress'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const hangup = frame.data[0];
    expect(hangup.verb).toBe('hangup');
    expect(hangup.headers).toBeDefined();
    expect(hangup.headers['X-Reason']).toBe('Call completed');
  });
});

// ---------------------------------------------------------------------------
// (c) dialAction with call_status failed + sip 486 -> sip:decline with status 486
// ---------------------------------------------------------------------------

describe('(c) /dialAction failed -> sip:decline', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('sip:decline verb with exact status 486', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'failed', dial_sip_status: 486});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(hookMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);

    const decline = frame.data[0];
    expect(decline.verb).toBe('sip:decline');
    expect(decline.status).toBe(486);
  });

  test('sip:decline has X-Reason header', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'failed', dial_sip_status: 486});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.data[0].headers['X-Reason']).toBe('Call failed');
  });

  test('sip:decline status 503 when dial_sip_status=503', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'failed', dial_sip_status: 503});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.data[0].verb).toBe('sip:decline');
    expect(frame.data[0].status).toBe(503);
  });

  test('call_status=no-answer also produces sip:decline', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialAction', {call_status: 'no-answer', dial_sip_status: 408});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.data[0].verb).toBe('sip:decline');
    expect(frame.data[0].status).toBe(408);
  });
});

// ---------------------------------------------------------------------------
// (d) dialRefer with x_reset=true and x_caller_id -> re-dial with new callerId
// ---------------------------------------------------------------------------

describe('(d) /dialRefer x_reset=true with x_caller_id -> dial with new callerId', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('reply dial has callerId from x_caller_id', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true',
        x_caller_id: '+1999'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(hookMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(dial.callerId).toBe('+1999');
  });

  test('reply dial target uses APP_TRUNK_NAME trunk', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true',
        x_caller_id: '+1999'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(Array.isArray(dial.target)).toBe(true);
    expect(dial.target[0].trunk).toBe(process.env.APP_TRUNK_NAME || 'test-trunk');
    expect(dial.target[0].type).toBe('phone');
    expect(dial.target[0].number).toBe('+15550002222');  // session.to
  });

  test('reply dial headers contain X-original-call-sid with session call_sid', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true',
        x_caller_id: '+1999'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(dial.headers).toBeDefined();
    expect(dial.headers['X-original-call-sid']).toBe(client.call_sid);
  });

  test('reply dial headers contain X-original-caller-id with original from', async() => {
    client = await makeConnectedClient({from: '+15550001111'});
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true',
        x_caller_id: '+1999'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(dial.headers['X-original-caller-id']).toBe('+15550001111');
  });

  test('x_reset=true without x_caller_id keeps original callerId', async() => {
    client = await makeConnectedClient({from: '+15550001111'});
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    // x_caller_id was absent so currentCallerId remains the original 'from'
    expect(dial.callerId).toBe('+15550001111');
  });
});

// ---------------------------------------------------------------------------
// (e) dialRefer with x_dest -> dial target type:'sip' with confirmHook
// ---------------------------------------------------------------------------

describe('(e) /dialRefer x_dest -> dial sip with confirmHook', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('reply dial has target type=sip and confirmHook=/dialMintConfirm', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(hookMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(Array.isArray(dial.target)).toBe(true);
    expect(dial.target).toHaveLength(1);
    expect(dial.target[0].type).toBe('sip');
    expect(dial.target[0].sipUri).toBe('sip:agent@pbx.example.com');
    expect(dial.confirmHook).toBe('/dialMintConfirm');
  });

  test('dial has actionHook=/dialAction and anchorMedia=true', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(dial.actionHook).toBe('/dialAction');
    expect(dial.anchorMedia).toBe(true);
  });

  test('dial has default dialMusic URL when x_dial_music is absent', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    expect(dial.dialMusic).toBe('https://versa-public.s3.us-east-1.amazonaws.com/dial-music.wav');
  });

  test('dial uses custom dialMusic when x_dial_music is set', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_dial_music: 'http://custom.example.com/hold.wav'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.dialMusic).toBe('http://custom.example.com/hold.wav');
  });
});

// ---------------------------------------------------------------------------
// (f) dialRefer with only refer_to_user (no x_dest, no x_reset) -> sip:refer
// ---------------------------------------------------------------------------

describe('(f) /dialRefer refer_to_user only -> sip:refer', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('reply contains sip:refer verb with referTo and actionHook', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        refer_to_user: 'someuser'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(hookMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    expect(frame.data).toHaveLength(1);

    const sipRefer = frame.data[0];
    expect(sipRefer.verb).toBe('sip:refer');
    expect(sipRefer.referTo).toBe('someuser');
    expect(sipRefer.actionHook).toBe('/sipReferAction');
  });

  test('sip_refer_to with uri params is relayed verbatim, not reduced to refer_to_user', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        sip_refer_to: '<sip:transfer-target@refer.example.invalid;user=phone;transport=tcp>',
        refer_to_user: 'transfer-target',
        sip_referred_by: '<sip:callee@example.invalid>',
        sip_user_agent: 'some-pbx'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const sipRefer = frame.data[0];
    expect(sipRefer.verb).toBe('sip:refer');
    expect(sipRefer.referTo).toBe('<sip:transfer-target@refer.example.invalid;user=phone;transport=tcp>');
    expect(sipRefer.referredBy).toBe('<sip:callee@example.invalid>');
    expect(sipRefer.actionHook).toBe('/sipReferAction');
    expect(sipRefer.headers).toBeUndefined();
  });

  test('custom x_ headers are forwarded, app control headers are not', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        sip_refer_to: '<sip:transfer-target@refer.example.invalid;user=phone>',
        refer_to_user: 'transfer-target',
        x_versa_custom: 'passthrough-value',
        x_account_ref: 'acct-42',
        x_caller_id: '+15551112222',
        x_dial_music: 'http://example.com/hold.wav'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const sipRefer = frame.data[0];
    expect(sipRefer.verb).toBe('sip:refer');
    expect(sipRefer.headers).toEqual({
      'X-Versa-Custom': 'passthrough-value',
      'X-Account-Ref': 'acct-42'
    });
  });

  test('sip_refer_to with an embedded uri header is relayed', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const referTo = '<sip:+61399301264@eims-asd-201and202.itrunk.business.connect.telstra.com?X-Vapi-Call-Id=01a07bde-a47b-799f-a444-56afa78ec458>';
    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        sip_refer_to: referTo,
        refer_to_user: '+61399301264'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );
    expect(frame.data[0].verb).toBe('sip:refer');
    expect(frame.data[0].referTo).toBe(referTo);
  });

  test('empty refer_details (no refer_to_user) -> verb validation throws, no reply frame sent', async() => {
    // SPEC GAP: when refer_to_user is absent, the else branch calls
    // sip_refer({referTo: undefined}) which fails verb validation and throws
    // synchronously inside addVerb before reply() is reached. The handler has
    // no surrounding try/catch so the WS session never sends a reply frame.
    // This is a genuine bug/gap in the route — we assert the observed real behaviour.
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const countBefore = client.received.length;
    client.sendHook('/dialRefer', {refer_details: {}});

    // wait briefly — no ack should arrive for this hook
    await new Promise((r) => setTimeout(r, 300));
    const newFrames = client.received.slice(countBefore);
    const hasNewAck = newFrames.some((f) => f.type === 'ack' || f.type === 'command');
    expect(hasNewAck).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (g) After refer received, dialAction just acks (isReferReceived path)
// ---------------------------------------------------------------------------

describe('(g) dialAction after refer -> ack-only (isReferReceived path)', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('dialAction after refer emits ack with no verb data', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // trigger a refer (any branch that sets isReferReceived=true)
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com'
      }
    });
    await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === referMsgid,
      {timeoutMs: TIMEOUT}
    );

    // now send dialAction — should hit isReferReceived path
    const actionMsgid = client.sendHook('/dialAction', {call_status: 'completed'});
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === actionMsgid,
      {timeoutMs: TIMEOUT}
    );

    // The isReferReceived path calls session.reply() with no verbs appended
    // so data should be absent or empty
    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(actionMsgid);
    const hasDialOrHangup = Array.isArray(frame.data) &&
      frame.data.some((v) => v.verb === 'dial' || v.verb === 'hangup' || v.verb === 'sip:decline');
    expect(hasDialOrHangup).toBe(false);
  });

  test('isReferReceived is cleared after dialAction — second dialAction with in-progress issues hangup', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // Set isReferReceived via a refer
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {refer_to_user: 'user1'}
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    // First dialAction consumes isReferReceived (sets it false)
    const firstMsgid = client.sendHook('/dialAction', {call_status: 'in-progress'});
    await client.waitFor((f) => f.type === 'ack' && f.msgid === firstMsgid, {timeoutMs: TIMEOUT});

    // Second dialAction should follow normal path -> hangup
    const secondMsgid = client.sendHook('/dialAction', {call_status: 'in-progress'});
    const frame2 = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === secondMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame2.data).toBeDefined();
    expect(frame2.data[0].verb).toBe('hangup');
  });
});

// ---------------------------------------------------------------------------
// (h) dialRefer with x_digits_delay, then dialMintConfirm in-progress -> pause+dtmf
// ---------------------------------------------------------------------------

describe('(h) /dialMintConfirm in-progress with x_digits_delay -> pause+dtmf sequence', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('single digit "1" (delay 100ms) produces pause+dtmf', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // x_digits_delay = '1' -> [{digit:'1', delay:100}]
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: '1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    // send dialMintConfirm with type='dial:confirm'
    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    expect(frame.type).toBe('ack');
    expect(frame.msgid).toBe(confirmMsgid);
    expect(Array.isArray(frame.data)).toBe(true);
    // delay > 0 -> pause first, then dtmf
    const verbs = frame.data.map((v) => v.verb);
    expect(verbs).toContain('pause');
    expect(verbs).toContain('dtmf');

    // pause comes before dtmf
    const pauseIdx = verbs.indexOf('pause');
    const dtmfIdx = verbs.indexOf('dtmf');
    expect(pauseIdx).toBeLessThan(dtmfIdx);
  });

  test('pause verb has length=1 (ceil(100/1000)=1)', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: '1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    const pause = frame.data.find((v) => v.verb === 'pause');
    expect(pause).toBeDefined();
    expect(pause.length).toBe(1);  // Math.ceil(100/1000) = 1
  });

  test('dtmf verb has exact digit and duration=100', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: '5'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dtmfVerb = frame.data.find((v) => v.verb === 'dtmf');
    expect(dtmfVerb).toBeDefined();
    expect(dtmfVerb.dtmf).toBe('5');
    expect(dtmfVerb.duration).toBe(100);
  });

  test('x_digits_delay with p pause modifier: "p1" -> delay=200ms -> pause length=1', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // 'p1' -> p adds 100ms to initial 100ms = 200ms accumulated, then digit '1'
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: 'p1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    const pause = frame.data.find((v) => v.verb === 'pause');
    expect(pause).toBeDefined();
    expect(pause.length).toBe(1);  // Math.ceil(200/1000) = 1

    const dtmfVerb = frame.data.find((v) => v.verb === 'dtmf');
    expect(dtmfVerb.dtmf).toBe('1');
  });

  test('x_digits_delay with S modifier: "S1" -> delay=1100ms -> pause length=2', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // 'S1' -> S adds 1000ms to initial 100ms = 1100ms, then digit '1'
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: 'S1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    const pause = frame.data.find((v) => v.verb === 'pause');
    expect(pause).toBeDefined();
    expect(pause.length).toBe(2);  // Math.ceil(1100/1000) = 2

    const dtmfVerb = frame.data.find((v) => v.verb === 'dtmf');
    expect(dtmfVerb.dtmf).toBe('1');
  });

  test('multi-digit "12" -> two pause+dtmf pairs', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // '12' -> [{digit:'1', delay:100}, {digit:'2', delay:100}]
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: '12'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    // Should have: pause, dtmf('1'), pause, dtmf('2') = 4 verbs
    expect(frame.data).toHaveLength(4);
    expect(frame.data[0].verb).toBe('pause');
    expect(frame.data[1].verb).toBe('dtmf');
    expect(frame.data[1].dtmf).toBe('1');
    expect(frame.data[2].verb).toBe('pause');
    expect(frame.data[3].verb).toBe('dtmf');
    expect(frame.data[3].dtmf).toBe('2');
  });

  test('dialMintConfirm with call_status NOT in-progress -> empty ack (no verbs)', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: '1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'failed'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    // call_status !== 'in-progress' -> session.reply() with no verbs
    const hasVerbs = Array.isArray(frame.data) && frame.data.length > 0;
    expect(hasVerbs).toBe(false);
  });

  test('X digit in x_digits_delay is skipped (not sent as dtmf)', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    // 'X1' -> X is skipped, '1' is sent -> only one dtmf verb
    const referMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_dest: 'sip:agent@pbx.example.com',
        x_digits_delay: 'X1'
      }
    });
    await client.waitFor((f) => f.type === 'ack' && f.msgid === referMsgid, {timeoutMs: TIMEOUT});

    const confirmMsgid = client.sendHook('/dialMintConfirm', {call_status: 'in-progress'}, 'dial:confirm');
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === confirmMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dtmfVerbs = frame.data.filter((v) => v.verb === 'dtmf');
    // X is skipped, only '1' produces a dtmf verb
    expect(dtmfVerbs).toHaveLength(1);
    expect(dtmfVerbs[0].dtmf).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// (i) Session lifecycle: ongoingSessions set/deleted
// ---------------------------------------------------------------------------

describe('(i) session lifecycle: ongoingSessions', () => {
  test('ongoingSessions.get(call_sid) is set after session:new', async() => {
    const client = await makeConnectedClient();
    const msgid = client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    expect(app.ongoingSessions.has(client.call_sid)).toBe(true);

    await client.close();
  });

  test('ongoingSessions.get(call_sid) is deleted after client closes', async() => {
    const client = await makeConnectedClient();
    const msgid = client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack' && f.msgid === msgid, {timeoutMs: TIMEOUT});

    expect(app.ongoingSessions.has(client.call_sid)).toBe(true);

    await client.close();

    // Poll until the close handler fires (allow up to 1s)
    const deadline = Date.now() + 1000;
    while (app.ongoingSessions.has(client.call_sid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(app.ongoingSessions.has(client.call_sid)).toBe(false);
  });

  test('two independent sessions tracked concurrently', async() => {
    const c1 = await makeConnectedClient();
    const c2 = await makeConnectedClient();

    const m1 = c1.sendSessionNew();
    const m2 = c2.sendSessionNew();
    await c1.waitFor((f) => f.type === 'ack' && f.msgid === m1, {timeoutMs: TIMEOUT});
    await c2.waitFor((f) => f.type === 'ack' && f.msgid === m2, {timeoutMs: TIMEOUT});

    expect(app.ongoingSessions.has(c1.call_sid)).toBe(true);
    expect(app.ongoingSessions.has(c2.call_sid)).toBe(true);
    expect(c1.call_sid).not.toBe(c2.call_sid);

    await c1.close();
    await c2.close();
  });
});

// ---------------------------------------------------------------------------
// Edge: dialRefer header key conversion (underscores -> hyphens)
// ---------------------------------------------------------------------------

describe('edge: refer_details header keys are converted underscore->hyphen', () => {
  let client;

  afterEach(async() => {
    if (client) await client.close();
  });

  test('x_reset path: extra refer_details keys become hyphenated headers', async() => {
    client = await makeConnectedClient();
    client.sendSessionNew();
    await client.waitFor((f) => f.type === 'ack', {timeoutMs: TIMEOUT});

    const hookMsgid = client.sendHook('/dialRefer', {
      refer_details: {
        x_reset: 'true',
        x_caller_id: '+1999',
        x_custom_header: 'myval'
      }
    });
    const frame = await client.waitFor(
      (f) => f.type === 'ack' && f.msgid === hookMsgid,
      {timeoutMs: TIMEOUT}
    );

    const dial = frame.data[0];
    expect(dial.verb).toBe('dial');
    // x_custom_header -> x-custom-header
    expect(dial.headers['x-custom-header']).toBe('myval');
    // refer_to_user is destructured out so it won't appear as header
    expect(dial.headers['refer_to_user']).toBeUndefined();
  });
});
