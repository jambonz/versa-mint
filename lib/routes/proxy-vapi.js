const { convertToDtmfSequence } = require("./utils");

const service = ({logger: parentLogger, makeService, ongoingSessions}) => {
  const svc = makeService({path: '/proxy-vapi'});

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
      .on('/dialAction', onDialAction.bind(null, session))
      .on('/dialRefer', onDialRefer.bind(null, session))
      .on('/sipReferAction', onSipReferAction.bind(null, session))
      .on('/dialMintConfirm', onDialMintConfirm.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      const {from, to} = session;
      session.locals.currentCallerId = from;
      session
        .dial({
          answerOnBridge: true,
          anchorMedia: true,
          actionHook: '/dialAction',
          referHook: '/dialRefer',
          headers: {
            'X-original-call-sid': call_sid,
          },
          timeLimit: 60 * 60, // 1 hour
          callerId: session.locals.currentCallerId,
          target: [
            {
              type: 'phone',
              number: to,
              trunk: process.env.APP_TRUNK_NAME
            }
          ]
        })
        .send();
      // const {statusCode, body} = await authCall(from);

      // if (statusCode !== 200) {
      //   // Handle authentication failure
      //   logger.error({statusCode, body}, 'Error while authenticating user');
      //   session
      //     .sip_decline({
      //       status: 480,
      //       headers: {
      //         "X-Reason" : "Failed to autneticate user"
      //       }
      //     })
      //     .send();
      // } else {
      //   // Proceed with the call if authentication is successful
      //   session
      //     .dial({
      //       answerOnBridge: true,
      //       anchorMedia: true,
      //       actionHook: '/dialAction',
      //       referHook: '/dialRefer',
      //       headers: body,
      //       timeLimit: 60 * 60, // 1 hour
      //       target: [
      //         {
      //           type: 'phone',
      //           number: to,
      //           trunk: process.env.APP_TRUNK_NAME
      //         }
      //       ]
      //     })
      //     .send();
      // }
    } catch (err) {
      // Handle any errors that occur during the authentication process
      logger.error({err}, 'error in session:new');
      session
        .sip_decline({
          status: 480,
          headers: {
            "X-Reason" : "Error processing request"
          }
        })
        .send();
    }
  });
}

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, `session dial action`);

  const {call_status, dial_sip_status} = evt;

  if (session.locals.isReferReceived) {
    logger.debug(`Dial action received after refer`);
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
          "X-Reason" : "Call failed"
        }
      })
      .reply();
    return;
  }

  session
    .hangup({
      headers: {
        "X-Reason" : "Call completed"
      }
    })
    .reply();
};

const onDialRefer = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, `session dial refer`);

  const {refer_details} = evt;
  const {refer_to_user, ...headers} = refer_details;
  
  // Convert header keys from underscore to hyphen format
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
        timeLimit: 60 * 60, // 1 hour
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
        timeLimit: 60 * 60,
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
  logger.debug({evt}, `session dial Mint confirm, start sending DTMF`);

  const {call_status} = evt;

  if (call_status === 'in-progress' && session.locals.digitsDelays && session.locals.digitsDelays.length > 0) {
    // Start with an empty response
    let response = session;
    let count = 0;
    
    // Chain each pause and DTMF action
    session.locals.digitsDelays.forEach((item) => {
      // Add pause action first (if there's a delay)
      if (item.delay > 0) {
        response = response.pause({length: Math.ceil(item.delay / 1000)});
      }
      // Then add the DTMF action
      if (item.digit !== 'X' && item.digit !== 'x') {
        count++;
        response = response.dtmf({
          dtmf: item.digit,
          duration: 100,
        });
      }
    });
    
    // Send the chained response
    response.reply();
    logger.info(`Sent DTMF sequence with ${count} digits`);
  } else {
    session.reply();
  }
};

const onSipReferAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, `session dial refer action`);

  session
    .hangup({
      headers: {
        "X-Reason" : "Refer action completed"
      }
    })
    .reply();
};

const onClose = (session, code, reason) => {
  const {logger, ongoingSessions} = session.locals;
  logger.debug({session, code, reason}, `session closed`);
  if (ongoingSessions.has(session.call_sid)) {
    ongoingSessions.delete(session.call_sid);
  }
};

const onError = (session, err) => {
  const {logger, ongoingSessions} = session.locals;
  if (ongoingSessions.has(session.call_sid)) {
    ongoingSessions.delete(session.call_sid);
  }
  logger.info({err}, `session received error`);
};

module.exports = service;
