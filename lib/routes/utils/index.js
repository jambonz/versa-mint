const crypto = require('crypto');

/**
 * Constant-time string comparison to avoid timing attacks on shared secrets.
 */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    /* still compare against itself to keep timing roughly constant */
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

const authCall = async (number) => {
  const response = await fetch(`${process.env.VERSA_BASE_URL}/v1/preload/${number}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VERSA_API_KEY
    }
  });

  const body = await response.json();
  return {statusCode: response.status, body};
}

const convertToDtmfSequence = (digitsDelayString) => {
  const sequence = [];
  let accumulatedDelay = 100;
  
  for (let i = 0; i < digitsDelayString.length; i++) {
    const char = digitsDelayString[i];
    
    if (char === 'p') {
      accumulatedDelay += 100; // p = 100ms delay
    } else if (char === 's') {
      accumulatedDelay += 500; // s = 500ms delay
    } else if (char === 'S') {
      accumulatedDelay += 1000; // S = 1000ms delay
    } else {
      // Regular digit or character to be sent
      sequence.push({
        digit: char,
        delay: accumulatedDelay
      });
      accumulatedDelay = 100; // Reset accumulated delay
    }
  }
  
  return sequence;
};


/**
 * Verify that an incoming call carries the expected x-versa-sip-key SIP header.
 *
 * This is a shared-secret SIP header check that adds an extra layer of
 * authentication to satisfy pen testing: a valid call must present the
 * `X-Versa-Sip-Key` header set to the value of the X_VERSA_SIP_KEY env var.
 * If the env var is not configured (unset or empty), the check is disabled
 * (returns true) so the app still works in environments without it.
 *
 * SIP header names are case-insensitive (RFC 3261), and jambonz may preserve
 * the original case from the INVITE (e.g. `X-versa-sip-key`), so we match the
 * header name case-insensitively. A repeated header may surface as an array, so
 * we normalize that too. The value comparison is constant-time to avoid leaking
 * the secret via timing.
 *
 * @param {object} session - the jambonz session (uses session.sip.headers)
 * @param {object} [logger] - optional logger for disabled/rejected diagnostics
 * @returns {boolean} true if the call is allowed, false if it should be dropped.
 */
const verifySipKey = (session, logger) => {
  const expected = process.env.X_VERSA_SIP_KEY;
  if (!expected || expected.trim() === '') {
    logger && logger.warn('X_VERSA_SIP_KEY not set - x-versa-sip-key header check is DISABLED');
    return true;
  }

  const headers = (session && session.sip && session.sip.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'x-versa-sip-key');
  const raw = key ? headers[key] : undefined;
  const actual = Array.isArray(raw) ? raw[0] : raw;
  if (!actual || !safeEqual(actual, expected)) {
    logger && logger.info('rejecting call: missing or invalid x-versa-sip-key header');
    return false;
  }
  return true;
};

/**
 * Drop an incoming call that failed the x-versa-sip-key check.
 */
const declineForbidden = (session) => {
  return session
    .sip_decline({
      status: 403,
      headers: {
        'X-Reason': 'Invalid or missing credentials'
      }
    })
    .send();
};

module.exports = {
  authCall,
  convertToDtmfSequence,
  verifySipKey,
  declineForbidden
}

