module.exports = ({logger, makeService}) => {
  require('./proxy-vapi')({logger, makeService, ongoingSessions});
  require('./dial-test-mint')({logger, makeService});
};

