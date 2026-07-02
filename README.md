# Family Grocery Bot — "Pantry"

Everyone texts a bot number → an AI understands the message → items land on your **AnyList**.
Channel-agnostic by design: the brain never changes when you swap transports.

## Run offline (no Mac, no Twilio, no keys)

```bash
node simulator.js                 # scripted family chat, balanced dial
DIAL=cautious node simulator.js   # confirm before every write

# Live-style webhook server (mock brain + mock AnyList):
node server.js
# then simulate a Twilio inbound in another shell:
curl -s -X POST localhost:3000/sms/twilio \
  --data-urlencode 'From=+15551230001' --data-urlencode 'Body=grab milk, eggs and tp'

# proactive layer (in-conversation nudge + scheduled digest):
node proactive-demo.js
node proactive.js          # one-off scheduled pass (dev-logs the outbound texts)
```

## Proactive check-ins
- **In-conversation nudge**: after an add, the bot may append "🧺 You usually also grab X — reply USUAL to add" (throttled to once / 6h per member). "USUAL" adds them.
- **Scheduled digest** (`proactive.js`): flags staples not added in a while ("⏰ haven't seen coffee (12d)") and offers usuals. Run it weekly via cron or this platform's live mode; it sends via the same Channel used for replies.

## Architecture

```
Twilio SMS (toll-free)  ─┐
  iMessage (future)    ─┼─►  Channel  ─►  conversation.js  ─►  brain.js (Claude/mock)
  any transport        ─┘   (parse/reply)   (policy+undo)        │
                                                          AnyList adapter (mock/real)
```

| File | Role |
|------|------|
| `brain.js` | Intent+entity extraction, confidence scoring, autonomy dial. Real Claude via `fetch`; mock fallback. |
| `conversation.js` | **Shared** handler: STOP/HELP, undo, pending clarifications, act/ask/answer/ignore. Used by BOTH simulator and server. |
| `channels/channel.js` | Transport interface (parseInbound / formatReply / send). |
| `channels/twilio-sms.js` | Twilio SMS transport: inbound webhook parse, TwiML reply, REST send. |
| `server.js` | Dependency-free webhook server; mounts a channel at `POST /sms/twilio`. |
| `anylist-adapter.js` | `MockAnyList` + `RealAnyList` sketch (undo on every write). |
| `memory.js` | Persistent household memory: per-member preferences + item frequency (usuals/staples + staleness), saved to JSON. Fed into the brain's context. |
| `suggestions.js` | Proactive engine: computes each member's "usuals not on the list" + stale staples from memory. |
| `proactive.js` | Scheduled check-ins: builds a digest per member and sends via the channel. Run on a cron / live mode. |
| `family.js` | Phone number → family member map (fake demo numbers). |
| `simulator.js` | Scripted conversation for offline testing. |
| `memory-demo.js` | Shows the bot learning preferences, persisting them, and enriching later messages. |
| `proactive-demo.js` | Shows the in-conversation nudge and the scheduled digest (with a stale-staple flag). |
| `TOLLFREE_VERIFICATION.md` | Copy-paste Twilio toll-free verification submission. |

## Use your real AnyList (test via the console)

The web console hits your real AnyList behind `USE_REAL_ANYLIST` — the way to verify the integration before any deployment.

```bash
npm i anylist            # one-time: installs the unofficial AnyList client
USE_REAL_ANYLIST=1 \
  ANYLIST_EMAIL="you@example.com" \
  ANYLIST_PASSWORD="your-anylist-password" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  node web-console.js
# open http://localhost:4000 — list names come from YOUR account;
# adds/removes appear in the AnyList app in real time.
```

Notes:
- Credentials come from env vars only — never hard-code them.
- Uses your AnyList email + password (the unofficial API doesn't support Apple/Google sign-in or 2FA — set an AnyList password if you signed up that way).
- Console `Reset` clears the bot's session memory only; it never wipes your real list.
- Drop the env vars to fall back to the mock instantly.

## Going live

1. **Register**: buy a Twilio toll-free number, submit `TOLLFREE_VERIFICATION.md`, wait for approval.
2. **Point the webhook**: number's inbound message webhook → `POST https://<public-url>/sms/twilio`.
3. **Set env** (never in chat): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ANTHROPIC_API_KEY`, and AnyList creds when you enable the real adapter.
4. **Real AnyList**: `npm i anylist`, enable `RealAnyList` in `anylist-adapter.js`.
5. **Host it**: any always-on box with a public HTTPS URL (a $5 VPS, a home server + tunnel, etc.) — no Mac required.

Add blue-bubble iMessage later by writing one more `Channel` and mounting a second route — the brain and conversation code stay untouched.
