const authCall = async (number) => {
  const {statusCode, body} = await fetch(`${process.env.VERSA_BASE_URL}/v1/preload/${number}`, {
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