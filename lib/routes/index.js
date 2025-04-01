module.exports = ({logger, makeService}) => {
  require('./proxy-vapi')({logger, makeService});
  require('./dial-test-mint')({logger, makeService});
};

