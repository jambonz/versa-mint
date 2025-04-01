const authCall = async (number) => {
  const response = await fetch(`${process.env.VERSA_BASE_URL}/v1/preload/${number}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VERSA_API_KEY
    }
  });

  const body = await response.json();
  return {statusCode: response.status, body};
}

module.exports = {
  authCall
}