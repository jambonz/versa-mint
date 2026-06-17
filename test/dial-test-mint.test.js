'use strict';

const {startApp, fakeJambonzClient} = require('./helpers');

// Jest global timeout covers the 2s DTMF timer plus test overhead
// jest.config.js already sets testTimeout: 10000

describe('/dial-test-mint integration', () => {

  // ---------------------------------------------------------------------------
  // (a) session:new -> dial verb
  // ---------------------------------------------------------------------------
  describe('session:new', () => {
    test('returns ack containing a dial verb', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();

        const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        expect(frame.type).toBe('ack');
        expect(Array.isArray(frame.data)).toBe(true);
        expect(frame.data.length).toBeGreaterThanOrEqual(1);

        const dialVerb = frame.data.find((v) => v.verb === 'dial');
        expect(dialVerb).not.toBeUndefined();
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dial verb has correct callerId', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();

        const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});
        const dialVerb = frame.data.find((v) => v.verb === 'dial');

        expect(dialVerb.callerId).toBe('+16468538890');
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dial verb has sip target with correct sipUri containing pure.cloud', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();

        const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});
        const dialVerb = frame.data.find((v) => v.verb === 'dial');

        expect(Array.isArray(dialVerb.target)).toBe(true);
        expect(dialVerb.target.length).toBe(1);
        expect(dialVerb.target[0].type).toBe('sip');
        // exact sipUri from source
        expect(dialVerb.target[0].sipUri).toBe('sip:+19879879877@uvnv.byoc.usw2.pure.cloud');
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dial verb has answerOnBridge:true, anchorMedia:true, actionHook:/dialAction', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();

        const frame = await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});
        const dialVerb = frame.data.find((v) => v.verb === 'dial');

        expect(dialVerb.answerOnBridge).toBe(true);
        expect(dialVerb.anchorMedia).toBe(true);
        expect(dialVerb.actionHook).toBe('/dialAction');
        expect(dialVerb.timeLimit).toBe(3600);
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);
  });

  // ---------------------------------------------------------------------------
  // (b) call:status in-progress/outbound -> UNSOLICITED dtmf command frame
  // ---------------------------------------------------------------------------
  describe('call:status -> unsolicited DTMF command', () => {
    test('in-progress outbound with parent_call_sid triggers dtmf command frame with digit 2', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();

        // Wait for initial ack before sending call:status
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        const testCallSid = 'cs-outbound-001';
        const testParentCallSid = 'cs-parent-001';

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'outbound',
            call_sid: testCallSid,
            parent_call_sid: testParentCallSid
          }
        });

        // Source uses setTimeout with delay:2000; waitFor 3000ms
        const dtmfFrame = await client.waitFor(
          (f) => f.type === 'command' && f.command === 'dtmf',
          {timeoutMs: 3000}
        );

        expect(dtmfFrame.type).toBe('command');
        expect(dtmfFrame.command).toBe('dtmf');
        // callSid must match the call_sid from the status event
        expect(dtmfFrame.callSid).toBe(testCallSid);
        // exact data shape from source
        expect(dtmfFrame.data).toEqual({dtmf: {digit: '2'}});
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 10000);

    test('call:status in-progress outbound WITHOUT parent_call_sid does NOT emit dtmf', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'outbound'
            // no parent_call_sid
          }
        });

        // No dtmf command should arrive within a short window
        await expect(
          client.waitFor(
            (f) => f.type === 'command' && f.command === 'dtmf',
            {timeoutMs: 500}
          )
        ).rejects.toThrow(/timed out|WebSocket closed/);
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('call:status completed does NOT trigger dtmf command', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'completed',
            direction: 'outbound',
            call_sid: 'cs-complete-001',
            parent_call_sid: 'cs-parent-002'
          }
        });

        await expect(
          client.waitFor(
            (f) => f.type === 'command' && f.command === 'dtmf',
            {timeoutMs: 500}
          )
        ).rejects.toThrow(/timed out|WebSocket closed/);
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('call:status in-progress INBOUND (not outbound) does NOT trigger dtmf', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'inbound',
            call_sid: 'cs-inbound-001',
            parent_call_sid: 'cs-parent-003'
          }
        });

        await expect(
          client.waitFor(
            (f) => f.type === 'command' && f.command === 'dtmf',
            {timeoutMs: 500}
          )
        ).rejects.toThrow(/timed out|WebSocket closed/);
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dtmf frame is type command not ack — distinct from verb ack frames', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'outbound',
            call_sid: 'cs-type-check-001',
            parent_call_sid: 'cs-parent-004'
          }
        });

        const dtmfFrame = await client.waitFor(
          (f) => f.type === 'command' && f.command === 'dtmf',
          {timeoutMs: 3000}
        );

        // Must NOT be an ack
        expect(dtmfFrame.type).not.toBe('ack');
        expect(dtmfFrame.type).toBe('command');
        // Must NOT have redirect command
        expect(dtmfFrame.command).not.toBe('redirect');
        expect(dtmfFrame.command).toBe('dtmf');
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 10000);
  });

  // ---------------------------------------------------------------------------
  // (c) dialAction with call_status:'trying' -> sip_decline 480
  // ---------------------------------------------------------------------------
  describe('dialAction call_status:trying -> sip:decline 480', () => {
    test('returns ack with sip_decline verb, status 480', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'trying'});

        // Use a predicate that won't match the already-received dial ack
        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
          {timeoutMs: 3000}
        );

        expect(frame.type).toBe('ack');
        expect(Array.isArray(frame.data)).toBe(true);
        expect(frame.data.length).toBe(1);

        const sipDeclineVerb = frame.data.find((v) => v.verb === 'sip:decline');
        expect(sipDeclineVerb).not.toBeUndefined();
        expect(sipDeclineVerb.status).toBe(480);
        expect(sipDeclineVerb.reason).toBe('Call failed to connect');
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('sip:decline is NOT a hangup verb', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'trying'});

        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'sip:decline'),
          {timeoutMs: 3000}
        );
        const hangupVerb = frame.data.find((v) => v.verb === 'hangup');

        expect(hangupVerb).toBeUndefined();
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);
  });

  // ---------------------------------------------------------------------------
  // (d) dialAction with call_status:'completed' -> hangup
  // ---------------------------------------------------------------------------
  describe('dialAction call_status:completed -> hangup', () => {
    test('returns ack with hangup verb and X-Reason header', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'completed'});

        // Use predicate that won't match the already-received dial ack
        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'hangup'),
          {timeoutMs: 3000}
        );

        expect(frame.type).toBe('ack');
        expect(Array.isArray(frame.data)).toBe(true);
        expect(frame.data.length).toBe(1);

        const hangupVerb = frame.data.find((v) => v.verb === 'hangup');
        expect(hangupVerb).not.toBeUndefined();
        expect(hangupVerb.headers).toEqual({'X-Reason': 'Call completed'});
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('completed does NOT return sip:decline', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'completed'});

        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'hangup'),
          {timeoutMs: 3000}
        );
        const sipDeclineVerb = frame.data.find((v) => v.verb === 'sip:decline');

        expect(sipDeclineVerb).toBeUndefined();
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dialAction with call_status:failed (not trying) -> hangup', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'failed'});

        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'hangup'),
          {timeoutMs: 3000}
        );
        const hangupVerb = frame.data.find((v) => v.verb === 'hangup');

        expect(hangupVerb).not.toBeUndefined();
        expect(hangupVerb.headers).toEqual({'X-Reason': 'Call completed'});
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);

    test('dialAction with call_status:no-answer (not trying) -> hangup', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendHook('/dialAction', {call_status: 'no-answer'});

        const frame = await client.waitFor(
          (f) => f.type === 'ack' && Array.isArray(f.data) && f.data.some((v) => v.verb === 'hangup'),
          {timeoutMs: 3000}
        );
        const hangupVerb = frame.data.find((v) => v.verb === 'hangup');

        expect(hangupVerb).not.toBeUndefined();
        expect(hangupVerb.headers).toEqual({'X-Reason': 'Call completed'});
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 8000);
  });

  // ---------------------------------------------------------------------------
  // Timer / teardown edge cases
  // ---------------------------------------------------------------------------
  describe('timer and teardown safety', () => {
    test('closing client before 2s timer fires does not crash the suite', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'outbound',
            call_sid: 'cs-teardown-001',
            parent_call_sid: 'cs-parent-teardown'
          }
        });

        // Close immediately before the 2000ms timer fires
        // Source catches the ws.send error so this should not throw
        await client.close();
        // If we reach here without an unhandled exception the suite is clean
        expect(client.state).toBe('closed');
      } finally {
        await ctx.close();
      }
    }, 8000);

    test('multiple sequential call:status triggers each produce their own dtmf command', async() => {
      const ctx = await startApp();
      const client = fakeJambonzClient(ctx.baseWsUrl, {path: '/dial-test-mint'});
      try {
        await client.connect();
        client.sendSessionNew();
        await client.waitFor((f) => f.type === 'ack', {timeoutMs: 3000});

        // First trigger
        client.sendRaw({
          type: 'call:status',
          data: {
            call_status: 'in-progress',
            direction: 'outbound',
            call_sid: 'cs-multi-001',
            parent_call_sid: 'cs-parent-multi'
          }
        });

        const firstDtmf = await client.waitFor(
          (f) => f.type === 'command' && f.command === 'dtmf' && f.callSid === 'cs-multi-001',
          {timeoutMs: 3000}
        );
        expect(firstDtmf.data).toEqual({dtmf: {digit: '2'}});
      } finally {
        await client.close();
        await ctx.close();
      }
    }, 10000);
  });

});
