const express = require('express');
const routes = express.Router();
const fs = require('fs');
const path = require('path');

routes.get('/:audio', async (req, res) => {
  const { audio } = req.params;
  const filePath = path.join(__dirname, '../../data', `${audio}`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio not found');
  }

  const headers = {
    "Content-Type": audio.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
    "Content-Disposition": `inline; filename="${audio}"`,
    "Content-Length": fs.statSync(filePath).size,
  };

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = routes;