# Versa-VAPI

A Node.js application for integrating Jambonz and VAPI phone services with DTMF sequence support.

## Features

- Call routing to VAPI via Jambonz trunk
- Call authentication via Versa API
- DTMF sequence sending with configurable delays
- SIP REFER handling for call transfers
- Audio file serving for call music
- SIP error simulator: DTMF code maps to a SIP / upstream error on the inbound INVITE

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
- **HTTP_USERNAME**: Username for websocket HTTP Basic auth (optional)
- **HTTP_PASSWORD**: Password for websocket HTTP Basic auth (optional)

## WebSocket Authentication

The websocket endpoints (e.g. `/proxy-vapi`) support optional HTTP Basic
authentication. Set `HTTP_USERNAME` and `HTTP_PASSWORD` to enable it; when set,
incoming websocket upgrade requests must include a matching
`Authorization: Basic` header or they are rejected with `401 Unauthorized`.

In jambonz, configure the application's websocket URL with the same username and
password so jambonz sends these credentials on connect. Authentication is only
enabled when **both** variables are set; otherwise it is disabled.

## DTMF Format

- Regular digits: 0-9, #, *
- Delays: p (100ms), s (500ms), S (1000ms)
- Example: "123#1pp2sS4" - Send "123#1", wait 200ms, send "2", wait 1500ms, send "4"

## Endpoints

- **/proxy-vapi**: Main call routing endpoint
- **/proxy-vapi-dtmf**: DTMF PIN gather then dial VAPI
- **/dial-test-mint**: DTMF testing endpoint
- **/sip-error**: SIP error simulator (see below)
- **GET /sip-errors**: Catalog of DTMF codes, SIP statuses, and upstream aliases
- **GET /audios/:audio**: Serves audio files

## SIP error simulator (`/sip-error`)

Point a Jambonz application at this websocket path to inject SIP failures.
An inbound call with no 3-digit `To` / `X-Simulate-Error` picks a random
**common** action (no gather): immediate `sip:decline` with `401` `403` `404`
`408` `480` `486` `487` `488` `500` `502` `503` `504` `600` `603` `608`, or
`900` (VAPI failed as `502`, never answered), or `920` (answer then hang up —
Jambonz up, VAPI failed). `To=401` / `To=900` / `To=920` / `X-Simulate-Error` still force a
specific code. If Jambonz has already answered (account recording),
`sip:decline` is skipped and the call is hung up instead.

| DTMF | Result |
| --- | --- |
| `401` | `401 Unauthorized` — **Jambonz only** (`X-Reason: Jambonz unauthorized`) |
| `407` | `407 Proxy Authentication Required` |
| `403` / `404` / `480` / `486` / `488` | matching SIP status |
| `300`–`380` | matching 3xx redirect |
| `500` / `502` / `503` / `504` | matching 5xx |
| `600` | `600 Busy Everywhere` |
| `607` / `608` | Unwanted / Rejected |
| `900` | `502` VAPI failed immediately (INVITE never 200s) |
| `902` | `407` VAPI unauthorized (not 401) |
| `901` / `903`–`911` | other upstream / VAPI aliases |
| `920` | Jambonz connected, VAPI failed: SIP **200** then **BYE** (`X-Reason: VAPI failed`) |
| `200` | connect to VAPI (`answerOnBridge`); VAPI’s SIP status is sent back, except **VAPI 401 is remapped to 407** |
| anything else | `400 Bad Request` (`X-Reason: Unknown error code`) |
| no digits / timeout | `408 Request Timeout` |

`GET /sip-errors` returns the full table. Declines include `X-Reason`,
`X-Error-Source` (`sip` / `upstream` / `vapi`), and `X-Dtmf-Code` when digits
were gathered.

### Simulating “Jambonz connected, VAPI then failed”

Two different SIP shapes, depending on whether the inbound INVITE should
stay unanswered:

**1. Answered, then VAPI failed (`920`) — 200 + BYE**

Jambonz accepts the inbound call (`200`), then hangs up as VAPI failed.
Twilio / the carrier sees a successful SIP connect and a BYE, not a
`sip:decline`. Use this when the next hop already treated Jambonz as up
and should fall through to IVR. Force it with `To=920` or
`X-Simulate-Error: 920`; the random DID pool includes `920` as well.

**2. Real VAPI hop (this app dials VAPI, INVITE stays unanswered)**

The inbound INVITE stays unanswered (`answerOnBridge`). After Jambonz has
the session, a failed outbound INVITE can still `sip:decline` the original
caller with VAPI’s SIP status.

Call `/sip-error` with `To=200` (or DTMF `200`). The app dials
`APP_TRUNK_NAME`. If that INVITE fails (`486`, `503`, …), the same status
is sent back on the inbound call. If VAPI itself returns `401`, it is
remapped to **`407`** so it is not confused with Jambonz unauthorized.
Force the failure by pointing the trunk at a down VAPI, a rejecting
carrier, or an unroutable number.

**3. Fake VAPI (this app *is* VAPI)** — use `900` / `902`, not `401`

`/proxy-vapi` cannot send DTMF to `/sip-error` (the caller is on dial music).
The outbound INVITE itself must carry the code:

| On the INVITE to `/sip-error` | Result |
| --- | --- |
| `To` user is `900` (`sip:900@…`) | `502` VAPI failed |
| `To` user is `902` | `407` VAPI unauthorized |
| `To` user is `486`, `503`, … | matching catalog entry |
| `To` user is `401` | `401` Jambonz unauthorized (not a VAPI failure) |
| header `X-Simulate-Error: 900` (or `X-Sip-Error`) | same, header wins over `To` |

Jambonz setup:

1. Application **sip-error** → `wss://<host>/sip-error`
2. Application **proxy** → `wss://<host>/proxy-vapi`, `APP_TRUNK_NAME` = a
   trunk that routes to the sip-error application
3. Assign test numbers `900`, `902`, `486`, `503`, … to **proxy** (or dial
   `sip:900@<sbc>` into proxy)

Call `900` → proxy dials `900` on the VAPI trunk → `/sip-error` declines
`502` → proxy’s `/dialAction` sees that status and declines the inbound
INVITE. That is the full “connected to Jambonz, failed to connect to VAPI”
path.

**4. Local Jambonz unauthorized (does not dial VAPI)**

Call `/sip-error` and enter DTMF `401` (or INVITE `To=401`). The inbound
INVITE is declined with `401 Unauthorized` / `X-Reason: Jambonz unauthorized`.

## Deployment

```
pm2 start ecosystem.config.js
```