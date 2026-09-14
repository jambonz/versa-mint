const {
  verifySipKey,
  declineForbidden,
  isConnectCode,
  errorCodeFromInvite,
  declineForDigits,
  declineNoCode,
  declineFromDialFailure,
  pickRandomErrorCode
} = require('./utils');

const DIAL_MUSIC_URL = process.env.DIAL_MUSIC_URL ||
  'https://versa-public.s3.us-east-1.amazonaws.com/dial-music.wav';

const service = ({logger: parentLogger, makeService, ongoingSessions}) => {
  const svc = makeService({path: '/sip-error'});

  svc.on('session:new', async(session) => {
    const {call_sid} = session;
    const logger = parentLogger.child({call_sid});

    if (!verifySipKey(session, logger)) {
      declineForbidden(session);
      return;
    }

    ongoingSessions.set(call_sid, session);
    session.locals = {
      logger,
      ongoingSessions
    };

    logger.debug({from: session.from, to: session.to}, `new incoming call: ${session.call_sid}`);

    session
      .on('/codeGather', onCodeGather.bind(null, session))
      .on('/dialAction', onDialAction.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      // Do not answer: sip:decline is the first verb so Twilio can see
      // the real SIP status. To / X-Simulate-Error still force a code;
      // otherwise pick a random catalog entry (no gather).
      const inviteCode = errorCodeFromInvite(session) || pickRandomErrorCode();
      logger.info({inviteCode, to: session.to}, 'sip-error immediate decline');
      applyCode(session, inviteCode).send();
    } catch (err) {
      logger.error({err}, 'error in session:new');
      rejectInbound(session, declineForDigits('500')).send();
    }
  });
};

/**
 * sip:decline only works before a final SIP response. Gather / account
 * recording often answers with 200 first — then decline is a no-op and
 * the caller sits on silence. Hang up after decline so the call still ends.
 */
const inboundAlreadyAnswered = (evt) => {
  if (!evt) return false;
  return evt.call_status === 'in-progress' || Number(evt.sip_status) === 200;
};

const rejectInbound = (session, decline, evt) => {
  const {logger} = session.locals;
  if (inboundAlreadyAnswered(evt)) {
    logger.info({decline}, 'INVITE already answered, hanging up instead of sip:decline');
    return session.hangup({headers: decline.headers});
  }
  return session.sip_decline(decline).hangup({headers: decline.headers});
};

const onCodeGather = (session, evt) => {
  const {logger} = session.locals;
  const {reason, digits} = evt;
  logger.debug({evt}, 'sip-error code gather result');

  if (reason !== 'dtmfDetected' || !digits) {
    logger.info({reason}, 'no error code received, declining');
    rejectInbound(session, declineNoCode(), evt).reply();
    return;
  }

  applyCode(session, digits, evt).reply();
};

const applyCode = (session, digits, evt) => {
  const {logger} = session.locals;
  if (isConnectCode(digits)) {
    logger.info({digits}, 'connect code received, dialing VAPI');
    return session.dial({
      answerOnBridge: true,
      anchorMedia: true,
      actionHook: '/dialAction',
      headers: {
        'X-original-call-sid': session.call_sid,
        'X-dtmf-code': digits
      },
      timeLimit: 3 * 60 * 60,
      dialMusic: DIAL_MUSIC_URL,
      callerId: session.from,
      target: [
        {
          type: 'phone',
          number: session.to,
          trunk: process.env.APP_TRUNK_NAME
        }
      ]
    });
  }

  const decline = declineForDigits(digits);
  logger.info({digits, decline}, 'declining inbound INVITE with mapped SIP error');
  return rejectInbound(session, decline, evt);
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, 'sip-error dial action');

  const {call_status, dial_sip_status} = evt;

  if (call_status === 'completed') {
    logger.debug('VAPI dial completed, no further action');
    session.reply();
    return;
  }

  if (call_status !== 'in-progress') {
    const decline = declineFromDialFailure(dial_sip_status);
    logger.info({call_status, decline}, 'VAPI connect failed, passing SIP error back');
    rejectInbound(session, decline, evt).reply();
    return;
  }

  session
    .hangup({
      headers: {
        'X-Reason': 'Call completed'
      }
    })
    .reply();
};

const onClose = (session, code, reason) => {
  const {logger, ongoingSessions} = session.locals;
  logger.debug({session, code, reason}, 'session closed');
  if (ongoingSessions.has(session.call_sid)) {
    ongoingSessions.delete(session.call_sid);
  }
};

const onError = (session, err) => {
  const {logger, ongoingSessions} = session.locals;
  if (ongoingSessions.has(session.call_sid)) {
    ongoingSessions.delete(session.call_sid);
  }
  logger.info({err}, 'session received error');
};

module.exports = service;
