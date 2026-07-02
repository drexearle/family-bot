# Twilio Toll-Free Verification — copy-paste submission

Submit in Twilio Console → **Messaging → Toll-Free Verification** (or Trust Hub) after buying a toll-free number. Replace every `<PLACEHOLDER>`. Fields below map to Twilio's form.

---

**Business / entity name:** `<YOUR FULL NAME>` (individual is fine)
**Business type:** Sole proprietor / Individual
**Website (optional but recommended):** `<link to the opt-in page — see note below, or leave blank>`
**Address:** `<YOUR US ADDRESS>`
**Contact email:** `<YOUR EMAIL>`
**Contact phone:** `<YOUR MOBILE, E.164>`

**Use-case category:** `Conversational` (two-way)

**Use-case description:**
> A private, family-only assistant. Members of one household text this number to add or remove items on the family's shared grocery/shopping list and to ask what is currently on it. The assistant replies with a short confirmation. This is strictly two-way conversational messaging between one household and its own assistant — no marketing, no promotional content, no third parties, and no messages to anyone outside the household.

**Estimated monthly message volume:** `1,000` (actual will be far lower; low bucket)

**Sample messages** (real traffic — note the brand name + opt-out in each):
1. `Grocery Bot: ✅ Added oat milk, eggs, and paper towels to your Groceries list. Reply UNDO to remove, STOP to opt out.`
2. `Grocery Bot: Your Groceries list — oat milk, eggs, coffee, paper towels. Reply STOP to opt out.`
3. `Grocery Bot: Add batteries to Groceries or Costco? Reply with the list name. Reply STOP to opt out.`

**Opt-in type:** Verbal / Other (self-initiated)

**Opt-in / consent description** (⚠️ the #1 rejection point — this wording is written to pass):
> All recipients are members of a single household who personally set up and use this assistant. Each family member opts in by saving the assistant's number and texting it first; consent is given verbally within the household at setup. No numbers are purchased, obtained from third parties, or added without the person's knowledge. Recipients opt out anytime by replying STOP and get help by replying HELP. Because all recipients are the account owner's own immediate family who initiate contact, there is no public web opt-in form.

**Additional information:**
> Personal, non-commercial family utility. Low volume, strictly intra-family. STOP/START/HELP are supported (Twilio Advanced Opt-Out is enabled and the app also handles these keywords).

---

### Notes to avoid a rejection cycle
- **A missing website/opt-in URL is the most common bounce.** If asked and you have none, the verbal/self-initiated description above is usually accepted for genuine low-volume personal use — but a tiny hosted "opt-in" page removes all doubt. (Ask me to generate and publish one; you'd paste its URL in the Website/opt-in field.)
- **Brand name + STOP in every message** — the sample messages already do this; keep it true in production.
- **Keep samples representative** of what you'll actually send.
- Turn on **Advanced Opt-Out** for the number so STOP/START/HELP are auto-handled at the carrier level (belt and suspenders with the app's own handling).
