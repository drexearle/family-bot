# Deploy always-on (no laptop)

## Why not Vercel
Vercel is serverless — code runs as short-lived functions with no persistent process.
This bot needs a persistent process: it holds a live WebSocket to AnyList and keeps
conversation state in memory (history for "add it to…", pending "reply yes", undo,
learned preferences). Serverless would drop all of that between requests. Use a host
that runs a long-lived Node process.

## Railway (recommended — easiest, ~$5/mo, always-on)
1. Push the code to GitHub (steps below).
2. Go to railway.app → New Project → Deploy from GitHub repo → pick your repo.
3. Railway auto-detects Node and runs `npm start` (= web-console.js).
4. Open the **Variables** tab and add:
   - `USE_REAL_ANYLIST` = `1`
   - `ANYLIST_EMAIL`, `ANYLIST_PASSWORD`
   - `ANTHROPIC_API_KEY`
   - `AUTH_USER`, `AUTH_PASS`  ← protects the public console (REQUIRED)
   - optional: `DEFAULT_LIST`, `DIAL`, `CLAUDE_MODEL`
5. Railway gives you a public HTTPS URL. Open it and log in with AUTH_USER / AUTH_PASS.

Updates: just `git push` — Railway redeploys automatically. No more download/extract.

To run the **SMS bot** instead of the console, set the start command to `node server.js`
(and point your Twilio toll-free webhook at `https://<your-url>/sms/twilio`).

## Put the code on GitHub (Windows / Cursor)
```powershell
cd ~\Downloads\family-bot
git init
git add .
git commit -m "family grocery bot"
# create an EMPTY repo at github.com/new (no README), then:
git remote add origin https://github.com/<your-username>/family-bot.git
git branch -M main
git push -u origin main
```
`.env` and `node_modules` are gitignored — your secrets never get committed. You set
secrets in Railway's Variables tab instead.

## Notes
- **Security:** the console can edit your AnyList, so always set `AUTH_USER`/`AUTH_PASS`
  before exposing it. (The Twilio webhook is protected differently — by Twilio request
  signatures — when you go SMS-live.)
- **Memory durability:** learned preferences live in memory / a JSON file and reset on
  redeploy on ephemeral hosts. Fine for now; add a small database or a mounted volume
  later if you want durable memory across deploys.
- **AnyList from a datacenter IP:** usually fine. If AnyList ever challenges the login,
  sign in once locally first to establish trust.
- **Render / Fly.io / a small VPS** work the same way (persistent Node service, set env
  vars, start = `npm start`). Avoid free tiers that sleep — they drop the AnyList socket.
