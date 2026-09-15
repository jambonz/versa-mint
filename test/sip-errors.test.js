'use strict';

const {
  CONNECT_CODE,
  CONNECT_THEN_FAIL_CODE,
  SIP_ERRORS,
  UPSTREAM_ERRORS,
  normalizeDigits,
  resolveErrorCode,
  isConnectCode,
  isConnectThenFail,
  hangupForConnectThenFail,
  errorCodeFromInvite,
  inviteUserPart,
  reasonForStatus,
  declineForDigits,
  declineNoCode,
  declineFromDialFailure,
  listErrors
} = require('../lib/routes/utils');

describe('sip-errors catalog', () => {
  test('401 maps to Unauthorized', () => {
    expect(resolveErrorCode('401')).toEqual({
      dtmf: '401',
      status: 401,
      reason: 'Unauthorized',
      source: 'sip',
      label: 'Jambonz unauthorized'
    });
  });

  test('accepts numeric and dirty digit strings', () => {
    expect(resolveErrorCode(486).status).toBe(486);
    expect(resolveErrorCode('4-8-6').status).toBe(486);
    expect(normalizeDigits('4#0#1')).toBe('401');
  });

  test('known SIP codes used in testing all resolve', () => {
    [400, 401, 403, 404, 408, 480, 486, 487, 488, 500, 502, 503, 504, 600, 603]
      .forEach((code) => {
        const resolved = resolveErrorCode(String(code));
        expect(resolved).not.toBeNull();
        expect(resolved.status).toBe(code);
        expect(resolved.source).toBe('sip');
        expect(resolved.reason).toBeTruthy();
      });
  });

  test('IANA/RFC SIP codes from the public list all resolve', () => {
    const wikiCodes = [
      300, 301, 302, 305, 380,
      400, 401, 402, 403, 404, 405, 406, 407, 408, 410,
      412, 413, 414, 415, 416, 417, 420, 421, 422, 423, 424, 425,
      428, 429, 430, 433, 436, 437, 438, 439, 440, 469, 470,
      480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 491, 493, 494,
      500, 501, 502, 503, 504, 505, 513, 555, 580,
      600, 603, 604, 606, 607, 608
    ];
    expect(Object.keys(SIP_ERRORS).map(Number).sort((a, b) => a - b)).toEqual(wikiCodes);
    wikiCodes.forEach((code) => {
      const resolved = resolveErrorCode(String(code));
      expect(resolved).not.toBeNull();
      expect(resolved.status).toBe(code);
      expect(resolved.source).toBe('sip');
    });
  });

  test('provisional, success, and obsolete RFC 2543 codes are not in the catalog', () => {
    [100, 180, 183, 199, 200, 202, 204, 409, 411].forEach((code) => {
      expect(resolveErrorCode(String(code))).toBeNull();
      expect(SIP_ERRORS[code]).toBeUndefined();
    });
  });

  test('9xx upstream aliases map to real SIP statuses', () => {
    expect(resolveErrorCode('900')).toMatchObject({
      status: 502, source: 'upstream', label: 'VAPI failed'
    });
    expect(resolveErrorCode('901')).toMatchObject({
      status: 504, source: 'upstream', label: 'VAPI timeout'
    });
    expect(resolveErrorCode('902')).toMatchObject({
      status: 407, source: 'upstream', label: 'VAPI unauthorized'
    });
  });

  test('unknown and empty codes do not resolve', () => {
    expect(resolveErrorCode('111')).toBeNull();
    expect(resolveErrorCode('')).toBeNull();
    expect(resolveErrorCode(undefined)).toBeNull();
  });

  test('errorCodeFromInvite reads To user part and simulate headers', () => {
    expect(errorCodeFromInvite({to: '401'})).toBe('401');
    expect(errorCodeFromInvite({to: 'sip:486@pbx.example'})).toBe('486');
    expect(errorCodeFromInvite({to: '+15550002222'})).toBeNull();
    expect(errorCodeFromInvite({
      to: '+15550002222',
      sip: {headers: {'X-Simulate-Error': '401'}}
    })).toBe('401');
    expect(errorCodeFromInvite({
      sip: {headers: {'x-sip-error': '900'}}
    })).toBe('900');
    expect(errorCodeFromInvite({to: '920'})).toBe('920');
    expect(errorCodeFromInvite({
      to: '+15550002222',
      sip: {headers: {'X-Simulate-Error': '920'}}
    })).toBe('920');
    expect(errorCodeFromInvite({
      to: '401',
      sip: {headers: {'X-Simulate-Error': '486'}}
    })).toBe('486');
    expect(inviteUserPart('sip:401@host')).toBe('401');
  });

  test('pickRandomErrorCode returns a catalog or connect-then-fail code, never 200', () => {
    const {pickRandomErrorCode, ERROR_CODE_POOL, resolveErrorCode} = require('../lib/routes/utils');
    expect(ERROR_CODE_POOL).toEqual([
      '401', '403', '404', '408',
      '480', '486', '487', '488',
      '500', '502', '503', '504',
      '600', '603', '608',
      '900',
      '920'
    ]);
    expect(ERROR_CODE_POOL).not.toContain('200');
    const seen = new Set();
    for (let i = 0; i < ERROR_CODE_POOL.length; i++) {
      const code = pickRandomErrorCode(() => i / ERROR_CODE_POOL.length);
      seen.add(code);
      expect(ERROR_CODE_POOL).toContain(code);
      if (code === CONNECT_THEN_FAIL_CODE) {
        expect(resolveErrorCode(code)).toBeNull();
        expect(isConnectThenFail(code)).toBe(true);
      } else {
        expect(resolveErrorCode(code)).not.toBeNull();
      }
    }
    expect(seen.size).toBe(ERROR_CODE_POOL.length);
    expect(resolveErrorCode('900')).toMatchObject({status: 502, label: 'VAPI failed'});
  });

  test('200 is the connect-to-VAPI code, not a decline', () => {
    expect(isConnectCode('200')).toBe(true);
    expect(isConnectCode(200)).toBe(true);
    expect(isConnectCode('401')).toBe(false);
    expect(resolveErrorCode('200')).toBeNull();
    expect(CONNECT_CODE).toBe('200');
  });

  test('920 is connect-then-fail, not a sip:decline catalog entry', () => {
    expect(isConnectThenFail('920')).toBe(true);
    expect(isConnectThenFail(920)).toBe(true);
    expect(isConnectThenFail('900')).toBe(false);
    expect(resolveErrorCode('920')).toBeNull();
    expect(CONNECT_THEN_FAIL_CODE).toBe('920');
    expect(hangupForConnectThenFail()).toEqual({
      headers: {
        'X-Reason': 'VAPI failed',
        'X-Error-Source': 'vapi',
        'X-Dtmf-Code': '920'
      }
    });
  });

  test('declineForDigits uses catalog reason and source', () => {
    expect(declineForDigits('401')).toEqual({
      status: 401,
      reason: 'Unauthorized',
      headers: {
        'X-Reason': 'Jambonz unauthorized',
        'X-Error-Source': 'sip',
        'X-Dtmf-Code': '401'
      }
    });
  });

  test('declineForDigits uses upstream label as X-Reason', () => {
    const decline = declineForDigits('900');
    expect(decline.status).toBe(502);
    expect(decline.reason).toBe('Bad Gateway');
    expect(decline.headers['X-Reason']).toBe('VAPI failed');
    expect(decline.headers['X-Error-Source']).toBe('upstream');
    expect(decline.headers['X-Dtmf-Code']).toBe('900');
  });

  test('unknown DTMF declines as 400 Bad Request', () => {
    expect(declineForDigits('111')).toEqual({
      status: 400,
      reason: 'Bad Request',
      headers: {
        'X-Reason': 'Unknown error code',
        'X-Error-Source': 'sip',
        'X-Dtmf-Code': '111'
      }
    });
  });

  test('missing DTMF declines as 408', () => {
    expect(declineNoCode()).toEqual({
      status: 408,
      reason: 'Request Timeout',
      headers: {
        'X-Reason': 'No code provided',
        'X-Error-Source': 'sip'
      }
    });
  });

  test('VAPI dial failure remaps 401 to 407 so it is not Jambonz unauthorized', () => {
    expect(declineFromDialFailure(401)).toEqual({
      status: 407,
      reason: 'Proxy Authentication Required',
      headers: {
        'X-Reason': 'VAPI Proxy Authentication Required',
        'X-Error-Source': 'vapi'
      }
    });
    expect(declineFromDialFailure(503).status).toBe(503);
    expect(declineFromDialFailure(407).status).toBe(407);
  });

  test('VAPI dial failure with a non-error SIP status falls back to 480', () => {
    expect(declineFromDialFailure(200).status).toBe(480);
    expect(declineFromDialFailure(undefined).status).toBe(480);
    expect(declineFromDialFailure('busy').status).toBe(480);
  });

  test('reasonForStatus falls back for unknown statuses', () => {
    expect(reasonForStatus(486)).toBe('Busy Here');
    expect(reasonForStatus(299)).toBe('Temporarily Unavailable');
  });

  test('listErrors exposes connect, sip, and upstream catalogs', () => {
    const listed = listErrors();
    expect(listed.connect).toEqual({
      dtmf: '200',
      action: 'dial-vapi',
      description: 'Connect to VAPI; pass any SIP failure back (VAPI 401 is remapped to 407)'
    });
    expect(listed.connectThenFail).toEqual({
      dtmf: '920',
      action: 'answer-then-hangup',
      description: 'Answer inbound (SIP 200) then hang up as VAPI failed so the caller sees 200 + BYE'
    });
    expect(listed.sip.length).toBe(Object.keys(SIP_ERRORS).length);
    expect(listed.upstream.length).toBe(Object.keys(UPSTREAM_ERRORS).length);
    expect(listed.sip.find((e) => e.dtmf === '401').reason).toBe('Unauthorized');
    expect(listed.upstream.find((e) => e.dtmf === '901').label).toBe('VAPI timeout');
  });
});
