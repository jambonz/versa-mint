const DTMF_SEQUENCE = [
  {
    digit: '1',
    // delay is in milliseconds compare with above digit in this list
    delay: 1000
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
  const {call_status, direction, call_sid} = evt;
  if (call_status === 'in-progress' && direction === 'outbound' && DTMF_SEQUENCE.length > 0) {
    // call is connected, start sending DTMF
    logger.info('call is connected, start sending DTMF');

    session
      .sendCommand("dtmf", {
        callSid: call_sid,
        dtmf: {
          digit: '1',
        }
      });

    // Function to send DTMF digits sequentially
    const sendDtmfSequence = (index = 0) => {
      if (index >= DTMF_SEQUENCE.length) return; // End of sequence
      
      const currentItem = DTMF_SEQUENCE[index];
      
      // Send the current digit
      session.sendCommand("dtmf", {
        callSid: call_sid,
        dtmf: {
          digit: currentItem.digit,
        }
      });
      
      logger.info(`Sent DTMF digit: ${currentItem.digit}`);
      
      // Schedule the next digit after the specified delay
      setTimeout(() => {
        sendDtmfSequence(index + 1);
      }, currentItem.delay);
    };

    // Start sending the DTMF sequence
    setTimeout(() => {
      sendDtmfSequence();
    }, DTMF_SEQUENCE[0].delay); 
  }
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  logger.debug({evt}, `session dial action`);

  session
    .hangup({
      headers: {
        "X-Reason" : "Call completed"
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