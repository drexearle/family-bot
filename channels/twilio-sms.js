'use strict';
const { Channel } = require('./channel');

/*
 * TwilioSmsChannel — Twilio Programmable Messaging (SMS) on a toll-free number.
 *
 * Inbound : Twilio POSTs application/x-www-form-urlencoded with From, To, Body.
 * Reply   : we return TwiML <Response><Message>…</Message></Response>, so the
 *           request/reply turn needs NO outbound credentials.
 * Proactive send(): Twilio REST API via Node's built-in fetch (needs creds).
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your toll-free number).
 */
class TwilioSmsChannel extends Channel {
  get name() { return 'twilio-sms'; }

  parseInbound(body) {
    const from = body.From || body.from;
    const text = body.Body != null ? body.Body : body.body;
    if (!from || text == null) return null;
    return { from, text: String(text) };
  }

  formatReply(text) {
    const head = '<?xml version="1.0" encoding="UTF-8"?>';
    if (!text) return `${head}<Response></Response>`;
    return `${head}<Response><Message>${escapeXml(text)}</Message></Response>`;
  }

  async send(to, text) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      console.log(`[twilio-sms:dev] would send to ${to}: ${text}`); // dev fallback: no creds
      return { dev: true };
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: text }).toString(),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

module.exports = { TwilioSmsChannel };
