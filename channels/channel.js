'use strict';
/*
 * Channel — the transport abstraction.
 *
 * The brain (brain.js) and the conversation logic (conversation.js) NEVER change
 * when you add or swap a transport. Each messaging provider just implements these
 * three methods. Today: TwilioSmsChannel. Later (drop-in): an iMessage channel.
 */
class Channel {
  get name() { return 'base'; }

  // Parse a provider's inbound webhook body -> { from, text }  (or null to ignore)
  parseInbound(/* body, headers */) { throw new Error('parseInbound not implemented'); }

  // Wrap a reply in the provider's synchronous webhook response ('' if nothing to say)
  formatReply(text) { return text || ''; }

  // Send a message out-of-band (proactive, e.g. "milk is running low").
  async send(/* to, text */) { throw new Error('send not implemented'); }
}

module.exports = { Channel };
