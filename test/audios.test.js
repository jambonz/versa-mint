'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const {startApp} = require('./helpers');

jest.setTimeout(10000);

const DATA_DIR = path.join(__dirname, '../data');
const MP3_FILE = 'dial-music.mp3';
const WAV_FILE = 'dial-music.wav';
const mp3Size = fs.statSync(path.join(DATA_DIR, MP3_FILE)).size;
const wavSize = fs.statSync(path.join(DATA_DIR, WAV_FILE)).size;

describe('GET /audios/:audio', () => {
  let ctx;

  beforeAll(async() => {
    ctx = await startApp();
  }, 10000);

  afterAll(async() => {
    await ctx.close();
  });

  // (a) .mp3 — status, Content-Type, Content-Length, body non-empty
  test('existing .mp3 returns 200, audio/mpeg, correct Content-Length', async() => {
    const res = await request(ctx.app)
      .get(`/audios/${MP3_FILE}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(Number(res.headers['content-length'])).toBe(mp3Size);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBe(mp3Size);
  }, 8000);

  // (b) .wav — status, Content-Type, Content-Length, body non-empty
  test('existing .wav returns 200, audio/wav, correct Content-Length', async() => {
    const res = await request(ctx.app)
      .get(`/audios/${WAV_FILE}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(Number(res.headers['content-length'])).toBe(wavSize);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBe(wavSize);
  }, 12000);

  // (c) Missing file returns 404 with exact body text
  test('missing file returns 404 and body "Audio not found"', async() => {
    const res = await request(ctx.app)
      .get('/audios/does-not-exist.wav');

    expect(res.status).toBe(404);
    expect(res.text).toBe('Audio not found');
  }, 5000);

  // (d) Content-Disposition header present with correct filename for .mp3
  test('.mp3 response has Content-Disposition inline with filename', async() => {
    const res = await request(ctx.app)
      .get(`/audios/${MP3_FILE}`)
      .buffer(false);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`inline; filename="${MP3_FILE}"`);
  }, 8000);

  // (d) Content-Disposition header present with correct filename for .wav
  test('.wav response has Content-Disposition inline with filename', async() => {
    const res = await request(ctx.app)
      .get(`/audios/${WAV_FILE}`)
      .buffer(false);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`inline; filename="${WAV_FILE}"`);
  }, 12000);

  // Edge: filename with no extension -> non-.mp3 branch returns audio/wav
  test('filename with no extension returns audio/wav content-type (non-.mp3 branch)', async() => {
    // This file does not exist; we only want to confirm the 404 path is hit cleanly
    // For the content-type branch, create a temp file and hit it
    const noExtFile = 'testnoext';
    const noExtPath = path.join(DATA_DIR, noExtFile);
    fs.writeFileSync(noExtPath, Buffer.from([0x00, 0x01, 0x02]));
    try {
      const res = await request(ctx.app)
        .get(`/audios/${noExtFile}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('audio/wav');
      expect(Number(res.headers['content-length'])).toBe(3);
      expect(res.headers['content-disposition']).toBe(`inline; filename="${noExtFile}"`);
    } finally {
      fs.unlinkSync(noExtPath);
    }
  }, 5000);

  // Edge: .MP3 uppercase extension does NOT match .mp3 check -> returns audio/wav
  test('.MP3 uppercase extension falls through to audio/wav branch (case-sensitive endsWith)', async() => {
    const upperFile = 'test-upper.MP3';
    const upperPath = path.join(DATA_DIR, upperFile);
    fs.writeFileSync(upperPath, Buffer.from([0xAA, 0xBB]));
    try {
      const res = await request(ctx.app)
        .get(`/audios/${upperFile}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      // Route uses .endsWith('.mp3') — uppercase .MP3 does NOT match -> audio/wav
      expect(res.headers['content-type']).toBe('audio/wav');
    } finally {
      fs.unlinkSync(upperPath);
    }
  }, 5000);

  // Edge: missing file with .mp3 extension still returns 404, not a content-type issue
  test('missing .mp3 file returns 404 and body "Audio not found"', async() => {
    const res = await request(ctx.app)
      .get('/audios/ghost.mp3');

    expect(res.status).toBe(404);
    expect(res.text).toBe('Audio not found');
  }, 5000);

  // Edge: path traversal attempt is treated as a literal filename (existsSync returns false)
  test('path traversal segment ../package.json returns 404', async() => {
    // Express router decodes %2F but the param stops at / boundary; '../../' in param
    // Let's test URL-encoded traversal and a dotdot-as-literal-name
    const res = await request(ctx.app)
      .get('/audios/..%2F..%2Fpackage.json');

    // Express treats %2F as a literal character in the param; fs.existsSync fails -> 404
    expect(res.status).toBe(404);
    expect(res.text).toBe('Audio not found');
  }, 5000);

  // Edge: Content-Length must equal the actual file byte size (not character count)
  test('Content-Length header is exact byte size of .mp3 file', async() => {
    const res = await request(ctx.app)
      .get(`/audios/${MP3_FILE}`);

    const contentLength = Number(res.headers['content-length']);
    expect(contentLength).toBeGreaterThan(0);
    expect(contentLength).toBe(mp3Size);
    expect(Number.isInteger(contentLength)).toBe(true);
  }, 8000);

  // Edge: repeated requests to same .mp3 return consistent headers (idempotency)
  test('two requests to same .mp3 return identical Content-Length', async() => {
    const [res1, res2] = await Promise.all([
      request(ctx.app).get(`/audios/${MP3_FILE}`),
      request(ctx.app).get(`/audios/${MP3_FILE}`),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.headers['content-length']).toBe(res2.headers['content-length']);
    expect(res1.headers['content-type']).toBe(res2.headers['content-type']);
  }, 10000);
});
