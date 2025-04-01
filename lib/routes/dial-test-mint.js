const DTMF_SEQUENCE = [
  {
    digit: '1',
    delay: 2000
  }
]

const service = ({logger: parentLogger, makeService}) => {
  const svc = makeService({path: '/dial-test-mint'});

  svc.on('session:new', async(session) => {
    const logger = parentLogger.child({call_sid: session.call_sid});
    session.locals = {
      logger
    };

    logger.debug({session}, `new incoming call: ${session.call_sid}`);

    session
      .on('/dialAction', onDialAction.bind(null, session))
      .on('call:status', onCallStatus.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      session
        .dial({
          answerOnBridge: true,
          actionHook: '/dialAction',
          callerId: '+16468538890',
          anchorMedia: true,
          timeLimit: 60 * 60, // 1 hour
          target: [
            {
              type: 'sip',
              sipUri: 'sip:19879879877@uvnv.byoc.usw2.pure.cloud',
            }
          ]
        })
        .send();
    }
    catch (err) {
      logger.error({err}, 'error in session:new');
      session
        .hangup(
          {
            headers: {
              "X-Reason" : "Failed to process call"
            }
          }
        )
        .send();
    }
  });
}


const onCallStatus = (session, evt) => {
  const {logger} = session.locals;
  logger.info({evt}, 'call status');
  const {call_status, direction, call_sid, parent_call_sid} = evt;
  if (parent_call_sid && call_status === 'in-progress' && direction === 'outbound' && DTMF_SEQUENCE.length > 0) {
    // call is connected, start sending DTMF
    logger.info('call is connected, start sending DTMF sequence');

    // Function to send DTMF digits sequentially
    const processSequence = (index = 0) => {
      if (index >= DTMF_SEQUENCE.length) return; // End of sequence

      const currentItem = DTMF_SEQUENCE[index];

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
  if (call_status === 'trying') {
    session
    .sip_decline({
      status: 480,
      reason: 'Call failed to connect',
    })
    .reply();
  } else {
    session
    .hangup({
      headers: {
        "X-Reason" : "Call completed"
      }
    })
    .reply();
  }

  
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