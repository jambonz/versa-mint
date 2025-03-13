const {request} = require('undici');



const authCall = async (number) => {
  const {statusCode, body} = await request(`${process.env.VERSA_BASE_URL}/v1/preload/${number}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VERSA_API_KEY
    }
  });

  const data = await body.json();
  return {statusCode, body: data};
}

module.exports = {
  authCall
}