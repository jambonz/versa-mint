/**
 * DTMF `200` means connect through to VAPI rather than decline the INVITE.
 * The inbound call stays unanswered (answerOnBridge) so a VAPI SIP failure
 * can still be sent back as sip:decline on the original INVITE.
 */
const CONNECT_CODE = '200';

/**
 * Answer the inbound INVITE (SIP 200) then hang up as VAPI failed.
 * Downstream sees 200 + BYE — Jambonz took the call, VAPI did not.
 * Distinct from `900` (immediate 502, never answered) and `200` (real VAPI dial).
 */
const CONNECT_THEN_FAIL_CODE = '920';

/* VAPI / trunk auth failure. Do not echo 401 — that means Jambonz unauth. */
const VAPI_UNAUTH_STATUS = 407;

/**
 * Final SIP responses this app can inject via DTMF (digits = status).
 * Covers IANA/RFC codes from the public SIP response list, minus:
 * 1xx (provisional), 2xx (200 is connect-to-VAPI), 202/204 (success),
 * 409/411 (obsolete RFC 2543, not in IANA). 603 is RFC 3261 Decline
 * (not the ATIS "Network Blocked" variant of the same code).
 */
const SIP_ERRORS = {
  /* 3xx — redirection */
  300: {status: 300, reason: 'Multiple Choices', source: 'sip'},
  301: {status: 301, reason: 'Moved Permanently', source: 'sip'},
  302: {status: 302, reason: 'Moved Temporarily', source: 'sip'},
  305: {status: 305, reason: 'Use Proxy', source: 'sip'},
  380: {status: 380, reason: 'Alternative Service', source: 'sip'},
  /* 4xx — client failure */
  400: {status: 400, reason: 'Bad Request', source: 'sip'},
  /* 401 is Jambonz-layer only (sip-key / UAS challenge). VAPI auth failures
     use 407 — see VAPI_UNAUTH_STATUS and DTMF 902. */
  401: {status: 401, reason: 'Unauthorized', source: 'sip', label: 'Jambonz unauthorized'},
  402: {status: 402, reason: 'Payment Required', source: 'sip'},
  403: {status: 403, reason: 'Forbidden', source: 'sip'},
  404: {status: 404, reason: 'Not Found', source: 'sip'},
  405: {status: 405, reason: 'Method Not Allowed', source: 'sip'},
  406: {status: 406, reason: 'Not Acceptable', source: 'sip'},
  407: {status: 407, reason: 'Proxy Authentication Required', source: 'sip'},
  408: {status: 408, reason: 'Request Timeout', source: 'sip'},
  410: {status: 410, reason: 'Gone', source: 'sip'},
  412: {status: 412, reason: 'Conditional Request Failed', source: 'sip'},
  413: {status: 413, reason: 'Request Entity Too Large', source: 'sip'},
  414: {status: 414, reason: 'Request-URI Too Long', source: 'sip'},
  415: {status: 415, reason: 'Unsupported Media Type', source: 'sip'},
  416: {status: 416, reason: 'Unsupported URI Scheme', source: 'sip'},
  417: {status: 417, reason: 'Unknown Resource-Priority', source: 'sip'},
  420: {status: 420, reason: 'Bad Extension', source: 'sip'},
  421: {status: 421, reason: 'Extension Required', source: 'sip'},
  422: {status: 422, reason: 'Session Interval Too Small', source: 'sip'},
  423: {status: 423, reason: 'Interval Too Brief', source: 'sip'},
  424: {status: 424, reason: 'Bad Location Information', source: 'sip'},
  425: {status: 425, reason: 'Bad Alert Message', source: 'sip'},
  428: {status: 428, reason: 'Use Identity Header', source: 'sip'},
  429: {status: 429, reason: 'Provide Referrer Identity', source: 'sip'},
  430: {status: 430, reason: 'Flow Failed', source: 'sip'},
  433: {status: 433, reason: 'Anonymity Disallowed', source: 'sip'},
  436: {status: 436, reason: 'Bad Identity-Info', source: 'sip'},
  437: {status: 437, reason: 'Unsupported Certificate', source: 'sip'},
  438: {status: 438, reason: 'Invalid Identity Header', source: 'sip'},
  439: {status: 439, reason: 'First Hop Lacks Outbound Support', source: 'sip'},
  440: {status: 440, reason: 'Max-Breadth Exceeded', source: 'sip'},
  469: {status: 469, reason: 'Bad Info Package', source: 'sip'},
  470: {status: 470, reason: 'Consent Needed', source: 'sip'},
  480: {status: 480, reason: 'Temporarily Unavailable', source: 'sip'},
  481: {status: 481, reason: 'Call/Transaction Does Not Exist', source: 'sip'},
  482: {status: 482, reason: 'Loop Detected', source: 'sip'},
  483: {status: 483, reason: 'Too Many Hops', source: 'sip'},
  484: {status: 484, reason: 'Address Incomplete', source: 'sip'},
  485: {status: 485, reason: 'Ambiguous', source: 'sip'},
  486: {status: 486, reason: 'Busy Here', source: 'sip'},
  487: {status: 487, reason: 'Request Terminated', source: 'sip'},
  488: {status: 488, reason: 'Not Acceptable Here', source: 'sip'},
  489: {status: 489, reason: 'Bad Event', source: 'sip'},
  491: {status: 491, reason: 'Request Pending', source: 'sip'},
  493: {status: 493, reason: 'Undecipherable', source: 'sip'},
  494: {status: 494, reason: 'Security Agreement Required', source: 'sip'},
  /* 5xx — server failure; 500 reason phrase is RFC 3261, not HTTP */
  500: {status: 500, reason: 'Server Internal Error', source: 'sip'},
  501: {status: 501, reason: 'Not Implemented', source: 'sip'},
  502: {status: 502, reason: 'Bad Gateway', source: 'sip'},
  503: {status: 503, reason: 'Service Unavailable', source: 'sip'},
  504: {status: 504, reason: 'Server Time-out', source: 'sip'},
  505: {status: 505, reason: 'Version Not Supported', source: 'sip'},
  513: {status: 513, reason: 'Message Too Large', source: 'sip'},
  555: {status: 555, reason: 'Push Notification Service Not Supported', source: 'sip'},
  580: {status: 580, reason: 'Precondition Failure', source: 'sip'},
  /* 6xx — global failure */
  600: {status: 600, reason: 'Busy Everywhere', source: 'sip'},
  603: {status: 603, reason: 'Decline', source: 'sip'},
  604: {status: 604, reason: 'Does Not Exist Anywhere', source: 'sip'},
  606: {status: 606, reason: 'Not Acceptable', source: 'sip'},
  607: {status: 607, reason: 'Unwanted', source: 'sip'},
  608: {status: 608, reason: 'Rejected', source: 'sip'}
};

/**
 * 9xx DTMF aliases for VAPI / trunk failures. The INVITE is declined with
 * the mapped SIP status; X-Reason carries the upstream label.
 */
const UPSTREAM_ERRORS = {
  900: {status: 502, reason: 'Bad Gateway', source: 'upstream', label: 'VAPI failed'},
  901: {status: 504, reason: 'Server Time-out', source: 'upstream', label: 'VAPI timeout'},
  902: {status: 407, reason: 'Proxy Authentication Required', source: 'upstream', label: 'VAPI unauthorized'},
  903: {status: 404, reason: 'Not Found', source: 'upstream', label: 'VAPI not found'},
  904: {status: 503, reason: 'Service Unavailable', source: 'upstream', label: 'VAPI overloaded'},
  905: {status: 408, reason: 'Request Timeout', source: 'upstream', label: 'VAPI no answer'},
  906: {status: 486, reason: 'Busy Here', source: 'upstream', label: 'VAPI busy'},
  907: {status: 488, reason: 'Not Acceptable Here', source: 'upstream', label: 'VAPI media rejected'},
  908: {status: 480, reason: 'Temporarily Unavailable', source: 'upstream', label: 'Upstream unavailable'},
  909: {status: 502, reason: 'Bad Gateway', source: 'upstream', label: 'Trunk failure'},
  910: {status: 403, reason: 'Forbidden', source: 'upstream', label: 'VAPI forbidden'},
  911: {status: 603, reason: 'Decline', source: 'upstream', label: 'VAPI declined'}
};

/**
 * Random DID actions: common sip:decline codes (including media `488`,
 * busy-everywhere `600`, rejected `608`), one immediate VAPI stand-in
 * (`900` → 502, never answered), and one connect-then-fail (`920` → 200 + BYE).
 * Forced To / X-Simulate-Error can still use any catalog code.
 */
const ERROR_CODE_POOL = [
  '401', '403', '404', '408',
  '480', '486', '487', '488',
  '500', '502', '503', '504',
  '600', '603', '608',
  '900',
  CONNECT_THEN_FAIL_CODE
];

/**
 * Random catalog code for an inbound DID (no gather). Excludes real
 * connect-to-VAPI `200` (that would succeed if the trunk is up).
 */
const pickRandomErrorCode = (random = Math.random) => {
  const index = Math.floor(random() * ERROR_CODE_POOL.length);
  return ERROR_CODE_POOL[index];
};

const normalizeDigits = (digits) => String(digits || '').replace(/\D/g, '');

const lookup = (table, code) => {
  const entry = table[code] || table[Number(code)];
  if (!entry) return null;
  return Object.assign({dtmf: code}, entry);
};

const resolveErrorCode = (digits) => {
  const code = normalizeDigits(digits);
  if (!code) return null;
  return lookup(SIP_ERRORS, code) || lookup(UPSTREAM_ERRORS, code);
};

const isConnectCode = (digits) => normalizeDigits(digits) === CONNECT_CODE;

const isConnectThenFail = (digits) => normalizeDigits(digits) === CONNECT_THEN_FAIL_CODE;

const hangupForConnectThenFail = () => ({
  headers: {
    'X-Reason': 'VAPI failed',
    'X-Error-Source': 'vapi',
    'X-Dtmf-Code': CONNECT_THEN_FAIL_CODE
  }
});

const SIMULATE_HEADER_NAMES = ['x-simulate-error', 'x-sip-error'];

/**
 * User part of session.to: "401", "sip:401@host", "+1555..." → digits only.
 */
const inviteUserPart = (to) => {
  const raw = String(to || '').trim();
  const withoutScheme = raw.replace(/^sips?:/i, '');
  const user = withoutScheme.split('@')[0];
  return normalizeDigits(user);
};

const headerValue = (headers, name) => {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  if (!key) return undefined;
  const raw = headers[key];
  return Array.isArray(raw) ? raw[0] : raw;
};

/**
 * True for a 3-digit connect / connect-then-fail code or a catalog error.
 * Longer DIDs must not match via Number() coercion (e.g. 0401 !== 401).
 */
const isInviteActionCode = (code) => {
  if (!code || code.length !== 3) return false;
  return isConnectCode(code) || isConnectThenFail(code) || Boolean(resolveErrorCode(code));
};

/**
 * Read a simulate-VAPI action off the inbound INVITE so /sip-error can
 * stand in for VAPI. /proxy-vapi dials this app with To=900 (or
 * X-Simulate-Error: 900); we decline immediately — no gather — because
 * the inbound caller is still on answerOnBridge + dial music and cannot
 * send DTMF to this outbound gather. To=401 is Jambonz unauthorized,
 * not a VAPI failure.
 *
 * Precedence: X-Simulate-Error / X-Sip-Error, then the To user part.
 * @returns {string|null} '200', '920', or a catalog code
 */
const errorCodeFromInvite = (session) => {
  const headers = (session && session.sip && session.sip.headers) || {};
  for (let i = 0; i < SIMULATE_HEADER_NAMES.length; i++) {
    const raw = headerValue(headers, SIMULATE_HEADER_NAMES[i]);
    const code = normalizeDigits(raw);
    if (isInviteActionCode(code)) return code;
  }
  const toCode = inviteUserPart(session && session.to);
  if (isInviteActionCode(toCode)) return toCode;
  return null;
};

const reasonForStatus = (status) => {
  const known = lookup(SIP_ERRORS, String(status));
  return known ? known.reason : 'Temporarily Unavailable';
};

/**
 * Options for session.sip_decline().
 */
const buildSipDecline = ({status, reason, source, dtmf, label}) => {
  const headers = {
    'X-Reason': label || reason,
    'X-Error-Source': source || 'sip'
  };
  if (dtmf) {
    headers['X-Dtmf-Code'] = String(dtmf);
  }
  return {status, reason, headers};
};

const declineForDigits = (digits) => {
  const resolved = resolveErrorCode(digits);
  if (!resolved) {
    return buildSipDecline({
      status: 400,
      reason: 'Bad Request',
      source: 'sip',
      dtmf: normalizeDigits(digits),
      label: 'Unknown error code'
    });
  }
  return buildSipDecline(resolved);
};

const declineNoCode = () => buildSipDecline({
  status: 408,
  reason: 'Request Timeout',
  source: 'sip',
  label: 'No code provided'
});

/**
 * When the outbound VAPI/trunk INVITE fails, pass that SIP status back on
 * the still-unanswered inbound INVITE. Non-error statuses fall back to 480.
 */
const declineFromDialFailure = (dialSipStatus) => {
  const numeric = Number(dialSipStatus);
  let status = numeric >= 300 ? numeric : 480;
  /* A 401 from VAPI must not look like Jambonz unauthorized. */
  if (status === 401) {
    status = VAPI_UNAUTH_STATUS;
  }
  const reason = reasonForStatus(status);
  return buildSipDecline({
    status,
    reason,
    source: 'vapi',
    label: `VAPI ${reason}`
  });
};

const listErrors = () => ({
  connect: {
    dtmf: CONNECT_CODE,
    action: 'dial-vapi',
    description: 'Connect to VAPI; pass any SIP failure back (VAPI 401 is remapped to 407)'
  },
  connectThenFail: {
    dtmf: CONNECT_THEN_FAIL_CODE,
    action: 'answer-then-hangup',
    description: 'Answer inbound (SIP 200) then hang up as VAPI failed so the caller sees 200 + BYE'
  },
  sip: Object.keys(SIP_ERRORS).map((dtmf) => Object.assign({dtmf}, SIP_ERRORS[dtmf])),
  upstream: Object.keys(UPSTREAM_ERRORS).map((dtmf) => Object.assign({dtmf}, UPSTREAM_ERRORS[dtmf]))
});

module.exports = {
  CONNECT_CODE,
  CONNECT_THEN_FAIL_CODE,
  VAPI_UNAUTH_STATUS,
  SIP_ERRORS,
  UPSTREAM_ERRORS,
  normalizeDigits,
  resolveErrorCode,
  isConnectCode,
  isConnectThenFail,
  hangupForConnectThenFail,
  inviteUserPart,
  errorCodeFromInvite,
  isInviteActionCode,
  reasonForStatus,
  buildSipDecline,
  declineForDigits,
  declineNoCode,
  declineFromDialFailure,
  listErrors,
  ERROR_CODE_POOL,
  pickRandomErrorCode
};
