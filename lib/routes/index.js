module.exports = ({logger, makeService, ongoingSessions}) => {
  require('./proxy-vapi')({logger, makeService, ongoingSessions});
  require('./proxy-vapi-dtmf')({logger, makeService, ongoingSessions});
  require('./dial-test-mint')({logger, makeService});
};

