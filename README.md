# Versa-VAPI

A Node.js application for integrating Jambonz and VAPI phone services with DTMF sequence support.

## Features

- Call routing to VAPI via Jambonz trunk
- Call authentication via Versa API
- DTMF sequence sending with configurable delays
- SIP REFER handling for call transfers
- Audio file serving for call music

## Quick Start

```sh
# Install dependencies
npm install

# Run the application
JAMBONZ_REST_API_BASE_URL=https://jambonz.one/api/v1 \
JAMBONZ_ACCOUNT_SID=your-account-sid \
JAMBONZ_API_KEY=your-api-key \
APP_TRUNK_NAME=your-trunk-name \
VERSA_BASE_URL=https://versa-api.example.com \
VERSA_API_KEY=your-versa-api-key \
npm start
```

## Environment Variables

- **JAMBONZ_REST_API_BASE_URL**: Jambonz API base URL
- **JAMBONZ_ACCOUNT_SID**: Your Jambonz account SID
- **JAMBONZ_API_KEY**: Your Jambonz API key
- **APP_TRUNK_NAME**: Jambonz trunk name for VAPI
- **VERSA_BASE_URL**: Versa API server URL
- **VERSA_API_KEY**: Versa API key
- **HTTP_PORT**: Web server port (default: 3000)
- **LOGLEVEL**: Logging level (default: debug)

## DTMF Format

- Regular digits: 0-9, #, *
- Delays: p (100ms), s (500ms), S (1000ms)
- Example: "123#1pp2sS4" - Send "123#1", wait 200ms, send "2", wait 1500ms, send "4"

## Endpoints

- **/proxy-vapi**: Main call routing endpoint
- **/dial-test-mint**: DTMF testing endpoint
- **GET /audios/:audio**: Serves audio files

## Deployment

```
pm2 start ecosystem.config.js
```