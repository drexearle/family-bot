# Run the Family Grocery Bot locally (connected to your real AnyList)

Goal: run the bot on your own Mac/PC, talking to the **real Claude brain** and your **real AnyList**, using the web console (no Twilio needed).

> **Windows users:** commands below are shown for macOS/Linux (bash). In **PowerShell**, use `copy` instead of `cp`, backslashes in paths, and — importantly — **do NOT** use `VAR=value node ...` (that's bash-only). Put your secrets in the `.env` file instead (Step 3) and just run `node web-console.js`. PowerShell also rejects `&&` — run commands on separate lines.

## 0. Prerequisites — Node.js 18+

Check:
```bash
node -v
```
If it prints `v18` or higher, you're set. If "command not found", install Node.js LTS from https://nodejs.org (or on a Mac with Homebrew: `brew install node`), then re-check.

## 1. Unpack the project (once)
```bash
cd ~/Downloads              # or wherever family-bot.tgz is
tar -xzf family-bot.tgz
cd family-bot
```

## 2. Install the AnyList client (once)
```bash
npm i anylist
```
(Everything else uses Node built-ins — this is the only dependency, and only needed for the real AnyList connection.)

## 3. Create your .env with secrets (once)
```bash
cp .env.example .env          # macOS/Linux
copy .env.example .env        # Windows PowerShell
```
Open `.env` in any editor and fill in:
```
USE_REAL_ANYLIST=1
ANYLIST_EMAIL=you@example.com
ANYLIST_PASSWORD=your-anylist-password
ANTHROPIC_API_KEY=sk-ant-...        # from console.anthropic.com
```
`.env` is gitignored — your secrets stay on your machine.

## 4. Run the console
```bash
node web-console.js
```
You'll see something like:
```
web console: http://localhost:4000  (claude brain, REAL AnyList)
  lists: Groceries, Costco, ...        <-- your real AnyList list names
```
Open **http://localhost:4000** in your browser.

## 5. Verify it's really hitting AnyList
- In the console, pick a family member and type `add oat milk and paper towels`.
- Open the **AnyList app** on your phone → the items appear on the list.
- Type `undo` in the console → they disappear. That's the full brain → AnyList loop working.

## Hooking up to any of your lists
- List names come straight from your account (shown on startup).
- Adds go to your **first list** by default. To target another, just name it:
  `add batteries to Costco`, `what's on the Costco list?`.

## Run the SMS bot locally too (optional)
Same core, Twilio front door:
```bash
node server.js          # POST /sms/twilio  (needs the toll-free step to go live)
```

## Running in Cursor / VS Code

Cursor is VS Code with AI, so everything above works there — you don't need the terminal if you don't want it:

1. **File → Open Folder →** choose `family-bot`.
2. Edit `.env` right in the editor (steps 2–3 above still apply once: `npm i anylist`, create `.env`).
3. Enable one-click run — create `.vscode/launch.json` from the shipped config:
   - macOS/Linux: `mkdir -p .vscode && cp vscode-launch.json .vscode/launch.json`
   - Windows PowerShell (two lines — no `&&`):
     ```powershell
     mkdir .vscode -Force
     copy vscode-launch.json .vscode\launch.json
     ```
   - Or skip the shell: in Cursor's file explorer, make a `.vscode` folder + `launch.json` file and paste the contents of `vscode-launch.json`.
4. Open **Run and Debug** (the ▶ icon in the sidebar), pick **"Web Console (real AnyList via .env)"**, and press **F5**. It auto-loads `.env`, runs in the integrated terminal, and supports breakpoints. Configs for the SMS server, simulator, and tests are included too.
5. Open http://localhost:4000 in your browser as usual.

Prefer the terminal? **View → Terminal** (`` Ctrl-` ``) and run the same `node web-console.js` command. Either way it's the same Node runtime — Cursor changes nothing about how it runs.

Bonus: the code is small and commented, so you can point Cursor's AI at any file to explain or extend it — or keep iterating here with me.

## Everyday use
- Start: `node web-console.js`  ·  Stop: `Ctrl-C`
- Switch to offline mock anytime: comment out the `USE_REAL_ANYLIST` / `ANTHROPIC_API_KEY` lines in `.env`.
- Change behavior: `DIAL=cautious` (confirm every add) or `aggressive` in `.env`.

## Troubleshooting
- **Login/auth error** → the unofficial API needs your AnyList **email + password**; it can't do Apple/Google sign-in or 2FA. If you signed up via Apple, set an AnyList password (AnyList app → account) and use that.
- **"AnyList list not found"** → you named a list that doesn't exist; check the `lists:` line printed on startup and use one of those names.
- **Claude 401 / brain seems dumb** → check `ANTHROPIC_API_KEY`. With no key it silently uses the offline mock brain.
- **`EADDRINUSE` / port busy** → set `WEB_PORT=4001` in `.env`.
- **Nothing shows in AnyList** → confirm the startup line says `REAL AnyList` (not `mock`) — that means `USE_REAL_ANYLIST=1` is set.

## Security
- Runs only on your machine (localhost). Don't expose it to the internet without adding a password first.
- Never commit `.env`. Never paste credentials into chat.
