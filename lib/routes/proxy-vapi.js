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
      .on("call:status", onCallStatus.bind(null, session))
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

const onCallStatus = (session, evt) => {
  const {logger, digitsDelays} = session.locals;
  logger.debug({evt}, 'call status');
  const {call_status, direction, call_sid, parent_call_sid} = evt;
  if (parent_call_sid &&
    call_status === 'in-progress' &&
    direction === 'outbound' &&
    digitsDelays && digitsDelays.length > 0) {
    // call is connected, start sending DTMF
    logger.info('call is connected to Mint, start sending DTMF sequence');

    // Function to send DTMF digits sequentially
    const processSequence = (index = 0) => {
      if (index >= digitsDelays.length) return; // End of sequence

      const currentItem = digitsDelays[index];

      // First wait for the specified delay, then send the digit
      logger.info(`Waiting ${currentItem.delay}ms before sending digit: ${currentItem.digit}`);

      setTimeout(() => {
        const msg = {
          type: 'command',
          command: 'dtmf',
          callSid: call_sid,
          data: {
            dtmf: {
              digit: currentItem.digit,
            }
          }
        };
        try {
          session.ws.send(JSON.stringify(msg));
        } catch (err) {
          logger.info({err, msg}, 'Error sending command to jambonz');
        }
        logger.info(`Sent DTMF digit: ${currentItem.digit}`);
        
        // Process the next digit immediately (no delay between sending and starting next delay)
        processSequence(index + 1);
      }, currentItem.delay);
    };

    // Start processing the sequence
    processSequence();
  }
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, `session dial action`);

  const {call_status} = evt;

  if (session.locals.isReferReceived) {
    logger.debug(`Dial action received after refer`);
    session.locals.isReferReceived = false;
    session.reply();
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

  const {refer_details} = body;
  const {refer_to_user} = refer_details;
  const destinationNumber = refer_details['x_dest'];
  const digitsDelay = refer_details['x_digits_delay'];

  if (digitsDelay) {
    session.locals.digitsDelays = convertToDtmfSequence(digitsDelay);
    logger.info({digitsDelay}, `converted to ${session.locals.digitsDelays}`);
  }

  if (destinationNumber && digitsDelay) {
    logger.info({destinationNumber, digitsDelay}, `Dialing ${destinationNumber} with DTMF delay of ${digitsDelay}ms`);
    session
      .dial({
        answerOnBridge: true,
        actionHook: '/dialAction',
        callerId: '+16468538890',
        anchorMedia: true,
        timeLimit: 60 * 60,
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

const onSipReferAction = (session, evt) => {
  const {logger} = session.locals;
  session.locals.isReferReceived = true;
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
