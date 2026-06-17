const {startApp} = require('./app');
const {fakeJambonzClient} = require('./jambonz-client');
const {startFakeUpstream} = require('./upstream');

const SUBPROTOCOL = 'ws.jambonz.org';

module.exports = {startApp, fakeJambonzClient, startFakeUpstream, SUBPROTOCOL};
