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

const convertToDtmfSequence = (digitsDelayString) => {
  const sequence = [];
  let accumulatedDelay = 100;
  
  for (let i = 0; i < digitsDelayString.length; i++) {
    const char = digitsDelayString[i];
    
    if (char === 'p') {
      accumulatedDelay += 100; // p = 100ms delay
    } else if (char === 's') {
      accumulatedDelay += 500; // s = 500ms delay
    } else if (char === 'S') {
      accumulatedDelay += 1000; // S = 1000ms delay
    } else {
      // Regular digit or character to be sent
      sequence.push({
        digit: char,
        delay: accumulatedDelay
      });
      accumulatedDelay = 100; // Reset accumulated delay
    }
  }
  
  return sequence;
};


module.exports = {
  authCall,
  convertToDtmfSequence
}