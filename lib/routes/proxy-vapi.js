const { authCall, convertToDtmfSequence } = require("./utils");

const service = ({logger: parentLogger, makeService}) => {
  const svc = makeService({path: '/proxy-vapi'});

  svc.on('session:new', async(session) => {
    const logger = parentLogger.child({call_sid: session.call_sid});
    session.locals = {
      logger
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
      const {statusCode, body} = await authCall(from);

      if (statusCode !== 200) {
        // Handle authentication failure
        logger.error({statusCode, body}, 'Error while authenticating user');
        session
          .hangup(
            {
              headers: {
                "X-Reason" : "Failed to autneticate user"
              }
            }
          )
          .send();
      } else {
        // Proceed with the call if authentication is successful
        session
          .dial({
            answerOnBridge: true,
            actionHook: '/dialAction',
            referHook: '/dialRefer',
            headers: body,
            timeLimit: 60 * 60, // 1 hour
            target: [
              {
                type: 'phone',
                number: to,
                trunk: process.env.APP_TRUNK_NAME
              }
            ]
          })
          .send();
      }
    } catch (err) {
      // Handle any errors that occur during the authentication process
      logger.error({err}, 'error in session:new');
      session
        .hangup(
          {
            headers: {
              "X-Reason" : "Error processing call"
            }
          }
        )
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
  const {refer_to_user} = refer_details;
  const destinationNumber = refer_details['x_dest'];
  const digitsDelay = refer_details['x_digits_delay'];
  const callerId = refer_details['x_caller_id'];

  if (digitsDelay) {
    session.locals.digitsDelays = convertToDtmfSequence(digitsDelay);
    logger.info({digitsDelay}, `converted to ${JSON.stringify(session.locals.digitsDelays)}`);
  }

  if (destinationNumber) {
    logger.info({destinationNumber, digitsDelay}, `Dialing ${destinationNumber} with DTMF delay of ${digitsDelay}ms`);
    session
      .dial({
        answerOnBridge: true,
        actionHook: '/dialAction',
        confirmHook: '/dialMintConfirm',
        ...(callerId && {callerId}),
        anchorMedia: true,
        timeLimit: 60 * 60,
        dialMusic: 'https://jambonz.versaconnects.link/apps/audios/dial-music.wav',
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
      if (item.digit !== 'X') {
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
  const {logger} = session.locals;
  logger.debug({session, code, reason}, `session closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session received error`);
};

module.exports = service;
