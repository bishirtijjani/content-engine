// diagrams/layouts/interface/chat.mjs — a chat or comment thread.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';

export default {
  name: 'chat',
  description: 'A short chat or comment thread, one message at a time',
  frame: 'full',
  fields: ['title', 'messages'],

  minDurationFor(n) { return playTime(1.0, 0.4, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const messages = Array.isArray(spec?.messages) ? spec.messages : [];
    checkCount(messages, 'messages', out, 2, 6);
    messages.forEach((m, i) => {
      checkLabel(m?.text, `messages[${i}].text`, out, { max: 120 });
      if (m?.name != null) checkLabel(m.name, `messages[${i}].name`, out, { max: MAX_NOTE, required: false });
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.messages) ? spec.messages : []).forEach((_, i) => out.push(`msg-${i}`));
    return out;
  },

  build(spec, c, P) {
    const messages = Array.isArray(spec?.messages) ? spec.messages : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    nodes.push(P.chat('chat', body, { messages, msgSlots: true, slot: false, fontSize: Math.round(P.unit * 0.026) }));
    messages.forEach((_, i) => build.push([`msg-${i}`]));

    return { nodes, build };
  },
};
