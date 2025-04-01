const { authCall } = require("./utils");

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

  session
    .sip_refer({
      referTo: refer_to_user,
      actionHook: '/sipReferAction',
    })
    .reply();
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
