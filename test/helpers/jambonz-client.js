const WebSocket = require('ws');
const crypto = require('crypto');

const SUBPROTOCOL = 'ws.jambonz.org';

function fakeJambonzClient(baseWsUrl, {path = '/', auth, sessionData = {}, connectTimeoutMs = 3000} = {}) {
  const url = baseWsUrl + path;
  const headers = auth
    ? {Authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}
    : {};

  const call_sid = sessionData.call_sid || crypto.randomUUID();
  const received = [];
  const sent = [];
  let ws = null;
  let state = 'idle'; // idle | connecting | open | closed | errored
  let messageListeners = [];

  const ws_instance = new WebSocket(url, SUBPROTOCOL, {headers});
  ws = ws_instance;

  ws.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    received.push(frame);
    const pending = messageListeners.slice();
    messageListeners = [];
    for (const fn of pending) {
      fn(frame);
    }
  });

  ws.on('open', () => {
    state = 'open';
  });

  ws.on('close', () => {
    state = 'closed';
    // unblock any waitFor/waitForClose listeners
    const pending = messageListeners.slice();
    messageListeners = [];
    for (const fn of pending) {
      fn(null); // null signals closed
    }
  });

  ws.on('error', () => {
    state = 'errored';
  });

  const connect = () => new Promise((resolve, reject) => {
    if (state === 'open') return resolve();

    let timer = null;
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };

    timer = setTimeout(() => {
      settle(reject, new Error('connect timeout'));
    }, connectTimeoutMs);

    if (state === 'closed' || state === 'errored') {
      return settle(reject, new Error(`WebSocket already ${state}`));
    }

    ws.once('open', () => settle(resolve));
    ws.once('error', (err) => settle(reject, err));
    ws.once('unexpected-response', (req, res) => {
      settle(reject, new Error(`unexpected-response: ${res.statusCode}`));
    });
    ws.once('close', () => {
      settle(reject, new Error('WebSocket closed before open'));
    });
  });

  const sendRaw = (obj) => {
    const str = JSON.stringify(obj);
    sent.push(obj);
    ws.send(str);
  };

  const sendSessionNew = () => {
    const msgid = crypto.randomUUID();
    sendRaw({
      type: 'session:new',
      msgid,
      call_sid,
      b3: '',
      data: {
        call_sid,
        from: sessionData.from || '+15550001111',
        to: sessionData.to || '+15550002222',
        direction: 'inbound',
        call_status: 'trying',
        sip_status: 100,
        ...sessionData
      }
    });
    return msgid;
  };

  const sendHook = (hook, data = {}, type = 'verb:hook') => {
    const msgid = crypto.randomUUID();
    sendRaw({type, msgid, hook, data});
    return msgid;
  };

  const waitFor = (predicate, {timeoutMs = 2500} = {}) => new Promise((resolve, reject) => {
    // Check already-received frames first
    const existing = received.find(predicate);
    if (existing) return resolve(existing);

    let timer = null;
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };

    const onFrame = (frame) => {
      if (frame === null) {
        // ws closed
        settle(reject, new Error('WebSocket closed while waiting for frame'));
        return;
      }
      if (predicate(frame)) {
        settle(resolve, frame);
      } else {
        // re-register for next message
        messageListeners.push(onFrame);
      }
    };

    timer = setTimeout(() => {
      settle(reject, new Error(
        `waitFor timed out after ${timeoutMs}ms. Frames seen: [${received.map((f) => f.type).join(', ')}]`
      ));
    }, timeoutMs);

    messageListeners.push(onFrame);
  });

  const waitForClose = () => new Promise((resolve) => {
    if (state === 'closed') return resolve();
    ws.once('close', resolve);
  });

  const close = () => new Promise((resolve) => {
    if (state === 'closed') return resolve();
    ws.once('close', resolve);
    ws.close();
  });

  return {
    call_sid,
    received,
    sent,
    get state() { return state; },
    connect,
    sendSessionNew,
    sendHook,
    sendRaw,
    waitFor,
    waitForClose,
    close
  };
}

module.exports = {fakeJambonzClient};
