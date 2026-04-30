const { convertToDtmfSequence } = require('./utils');

const DTMF_LOOKUP_URL = 'https://api.dev-versaconnects.com.au/v1/getPhoneNumberByDtfm';

const service = ({logger: parentLogger, makeService, ongoingSessions}) => {
  const svc = makeService({path: '/proxy-vapi-dtmf'});

  svc.on('session:new', async(session) => {
    const {call_sid} = session;
    const logger = parentLogger.child({call_sid});
    ongoingSessions.set(call_sid, session);
    session.locals = {
      logger,
      ongoingSessions
    };

    logger.debug({session}, `new incoming call: ${session.call_sid}`);

    session
      .on('/codeGather', onCodeGather.bind(null, session))
      .on('/dialAction', onDialAction.bind(null, session))
      .on('/dialRefer', onDialRefer.bind(null, session))
      .on('/sipReferAction', onSipReferAction.bind(null, session))
      .on('/dialMintConfirm', onDialMintConfirm.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      const {from} = session;
      session.locals.currentCallerId = from;
      session
        .answer()
        .gather({
          actionHook: '/codeGather',
          input: ['digits'],
          numDigits: 4,
          timeout: 10,
          say: {
            text: 'Please enter your 4 digit code.'
          }
        })
        .send();
    } catch (err) {
      logger.error({err}, 'error in session:new');
      session
        .sip_decline({
          status: 480,
          headers: {
            'X-Reason': 'Error processing request'
          }
        })
        .send();
    }
  });
};

const onCodeGather = async (session, evt) => {
  const {logger} = session.locals;
  const {call_sid, to} = session;
  const {reason, digits} = evt;
  logger.debug({evt}, 'code gather result');

  if (reason !== 'dtmfDetected' || !digits) {
    logger.info({reason}, 'no code received, declining call');
    session
      .sip_decline({
        status: 480,
        headers: {
          'X-Reason': 'No code provided'
        }
      })
      .reply();
    return;
  }

  try {
    const response = await fetch(DTMF_LOOKUP_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: digits})
    });
    const body = await response.json();

    if (!response.ok || !body.success || !body.phone_number) {
      logger.info({status: response.status, body}, 'code lookup failed');
      session
        .sip_decline({
          status: 480,
          headers: {
            'X-Reason': body.error_message || 'Invalid code'
          }
        })
        .reply();
      return;
    }

    logger.info({phone_number: body.phone_number}, 'code lookup succeeded, dialing');
    session
      .dial({
        answerOnBridge: true,
        anchorMedia: true,
        actionHook: '/dialAction',
        referHook: '/dialRefer',
        headers: {
          'X-original-call-sid': call_sid,
          'X-phone-number': body.phone_number
        },
        timeLimit: 3 * 60 * 60,
        callerId: session.locals.currentCallerId,
        target: [
          {
            type: 'phone',
            number: to,
            trunk: process.env.APP_TRUNK_NAME
          }
        ]
      })
      .reply();
  } catch (err) {
    logger.error({err}, 'error looking up phone number by code');
    session
      .sip_decline({
        status: 480,
        headers: {
          'X-Reason': 'Code lookup error'
        }
      })
      .reply();
  }
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, 'session dial action');

  const {call_status, dial_sip_status} = evt;

  if (session.locals.isReferReceived) {
    logger.debug('Dial action received after refer');
    session.locals.isReferReceived = false;
    session.reply();
    return;
  }

  if (call_status !== 'in-progress') {
    logger.debug(`Dial action received with status ${call_status}, call is not in progress, declining call`);
    session
      .sip_decline({
        status: dial_sip_status,
        headers: {
          'X-Reason': 'Call failed'
        }
      })
      .reply();
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

const onDialRefer = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, 'session dial refer');

  const {refer_details} = evt;
  const {refer_to_user, ...headers} = refer_details;

  const modifiedHeaders = Object.keys(headers).reduce((acc, key) => {
    const newKey = key.replace(/_/g, '-');
    acc[newKey] = headers[key];
    return acc;
  }, {});

  const destinationNumber = refer_details['x_dest'];
  const digitsDelay = refer_details['x_digits_delay'];
  const callerId = refer_details['x_caller_id'];
  const reset = refer_details['x_reset'];
  const dialMusic = refer_details['x_dial_music'];
  session.locals.isReferReceived = true;

  if (digitsDelay) {
    session.locals.digitsDelays = convertToDtmfSequence(digitsDelay);
    logger.info({digitsDelay}, `converted to ${JSON.stringify(session.locals.digitsDelays)}`);
  }

  if (callerId) {
    logger.info(`Setting caller ID to ${callerId}`);
    session.locals.currentCallerId = callerId;
  }

  if (reset || reset === 'true') {
    logger.info(`reset the call, dialing from old caller ID: ${session.from} new caller ID ${callerId} to ${session.to}`);

    session
      .dial({
        anchorMedia: true,
        actionHook: '/dialAction',
        referHook: '/dialRefer',
        headers: {
          ...modifiedHeaders,
          'X-original-caller-id': session.from,
          'X-original-call-sid': session.call_sid
        },
        callerId: session.locals.currentCallerId,
        timeLimit: 3 * 60 * 60,
        target: [
          {
            type: 'phone',
            number: session.to,
            trunk: process.env.APP_TRUNK_NAME
          }
        ]
      })
      .reply();
  }
  else if (destinationNumber) {
    logger.info({destinationNumber, digitsDelay}, `Dialing ${destinationNumber} with DTMF delay of ${digitsDelay}ms`);
    session
      .dial({
        actionHook: '/dialAction',
        confirmHook: '/dialMintConfirm',
        callerId: session.locals.currentCallerId,
        anchorMedia: true,
        timeLimit: 3 * 60 * 60,
        dialMusic: dialMusic || 'https://versa-public.s3.us-east-1.amazonaws.com/dial-music.wav',
        target: [
          {
            type: 'sip',
            sipUri: destinationNumber,
          }
        ]
      })
      .reply();
  } else {
    session
      .sip_refer({
        referTo: refer_to_user,
        actionHook: '/sipReferAction',
      })
      .reply();
  }
};

const onDialMintConfirm = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, 'session dial Mint confirm, start sending DTMF');

  const {call_status} = evt;

  if (call_status === 'in-progress' && session.locals.digitsDelays && session.locals.digitsDelays.length > 0) {
    let response = session;
    let count = 0;

    session.locals.digitsDelays.forEach((item) => {
      if (item.delay > 0) {
        response = response.pause({length: Math.ceil(item.delay / 1000)});
      }
      if (item.digit !== 'X' && item.digit !== 'x') {
        count++;
        response = response.dtmf({
          dtmf: item.digit,
          duration: 100,
        });
      }
    });

    response.reply();
    logger.info(`Sent DTMF sequence with ${count} digits`);
  } else {
    session.reply();
  }
};

const onSipReferAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, 'session dial refer action');

  session
    .hangup({
      headers: {
        'X-Reason': 'Refer action completed'
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
