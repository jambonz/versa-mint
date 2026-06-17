const crypto = require('crypto');

/**
 * Constant-time string comparison to avoid timing attacks.
 */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    /* still compare against itself to keep timing roughly constant */
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

const unauthorized = (res, logger, reason) => {
  logger && logger.info(`websocket auth rejected: ${reason}`);
  res.writeHead(401, {
    'Content-Type': 'text/plain',
    'WWW-Authenticate': 'Basic realm="versa-vapi"'
  });
  res.end('401 Unauthorized');
};

/**
 * Express-style middleware that enforces HTTP Basic authentication on the
 * websocket upgrade request.
 *
 * Credentials are read once from the HTTP_USERNAME / HTTP_PASSWORD env vars.
 * If neither is set, authentication is disabled (middleware is a no-op) so that
 * the app keeps working in environments where auth is not required.
 *
 * jambonz sends these credentials as an `Authorization: Basic` header on the
 * websocket connection when the application is configured with a username and
 * password.
 */
module.exports = ({logger} = {}) => {
  const expectedUser = process.env.HTTP_USERNAME;
  const expectedPass = process.env.HTTP_PASSWORD;

  if (!expectedUser || !expectedPass) {
    logger && logger.info(
      'HTTP_USERNAME/HTTP_PASSWORD not both set - websocket basic auth is DISABLED');
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    const reqLogger = (req.locals && req.locals.logger) || logger;
    const header = req.headers && req.headers.authorization;

    if (!header || !header.startsWith('Basic ')) {
      return unauthorized(res, reqLogger, 'missing or malformed Authorization header');
    }

    let decoded;
    try {
      decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    } catch (err) {
      return unauthorized(res, reqLogger, 'unable to decode credentials');
    }

    const idx = decoded.indexOf(':');
    if (idx === -1) {
      return unauthorized(res, reqLogger, 'malformed credentials');
    }
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    const userOk = safeEqual(user, expectedUser);
    const passOk = safeEqual(pass, expectedPass);
    if (!userOk || !passOk) {
      return unauthorized(res, reqLogger, 'invalid credentials');
    }

    next();
  };
};
