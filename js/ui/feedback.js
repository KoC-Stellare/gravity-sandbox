import { h } from './dom.js';
import { sendFeedback } from '../net/supa.js';

const MAX = 1000;
const COOLDOWN_MS = 20000;   // one message every 20 s per player, on top of the database limit
let lastSent = 0;

/**
 * Feedback panel: type (bug / idea / other), text with counter, send.
 * While it is open the game ignores keyboard and mouse and pointer lock is released;
 * closing it gives control back to the game.
 */
export function openFeedback(app) {
  if (document.querySelector('.feedback-wrap')) return;
  const input = app.input;
  const game = app.game;
  const wasPlaying = game.mode === 'play';
  input.suspend(true);

  const category = h('select#fb-cat', { name: 'category' },
    h('option', { value: 'bug' }, 'Bug'), h('option', { value: 'idea' }, 'Idea'), h('option', { value: 'altro' }, 'Other'));
  const text = h('textarea.input.fb-text#fb-text', { maxLength: MAX, rows: 6, placeholder: 'What happened, or what would you like to see?' });
  const counter = h('span.fb-count', `0 / ${MAX}`);
  // Honeypot: invisible to people, bots fill it in. If it has a value we pretend to send.
  const trap = h('input.fb-trap', { type: 'text', name: 'website', tabIndex: -1, autocomplete: 'off', 'aria-hidden': 'true' });
  const status = h('p.err.fb-status', { role: 'status', 'aria-live': 'polite' });
  const send = h('button.btn.primary', { type: 'submit' }, 'Send');
  const cancel = h('button.btn', { type: 'button' }, 'Close');

  const form = h('form.modal.feedback',
    h('div.modal-head', h('h3', 'Send feedback'), h('button.icon-btn', { type: 'button', title: 'Close', onclick: () => close() }, '✕')),
    h('div.modal-body',
      h('p.small', 'Found a bug or have an idea? Tell us. Messages are anonymous and only read by the developers.'),
      h('label.field', h('span', 'Type'), category),
      h('label.field', h('span', 'Message'), text),
      h('div.fb-meta', counter),
      trap,
      status),
    h('div.modal-actions', cancel, send));
  const wrap = h('div.modal-wrap.feedback-wrap', form);

  const setStatus = (msg, ok = false) => { status.textContent = msg; status.classList.toggle('ok', ok); };
  text.addEventListener('input', () => { counter.textContent = `${text.value.length} / ${MAX}`; setStatus(''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (send.disabled) return;
    const msg = text.value.trim();
    if (msg.length < 5) { setStatus('Write at least 5 characters.'); text.focus(); return; }
    if (trap.value) { done(); return; }
    const wait = COOLDOWN_MS - (Date.now() - lastSent);
    if (wait > 0) { setStatus(`Please wait ${Math.ceil(wait / 1000)} s before sending another message.`); return; }
    send.disabled = true;
    send.textContent = 'Sending…';
    setStatus('');
    try {
      await sendFeedback(msg, category.value);
      lastSent = Date.now();
      done();
    } catch (err) {
      setStatus(err.message || 'Could not send your feedback.');
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
    }
  });
  function done() {
    text.value = '';
    counter.textContent = `0 / ${MAX}`;
    setStatus('Thanks! Your feedback was sent.', true);
  }

  // Keys typed here must never reach the game (or the global Esc handler that resumes play).
  wrap.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  wrap.addEventListener('keyup', (e) => e.stopPropagation());
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  cancel.addEventListener('click', () => close());

  function close() {
    wrap.remove();
    input.suspend(false);
    // back into the game: the close click / Esc press counts as the gesture pointer lock needs
    if (wasPlaying && game.mode === 'play') game.resume();
  }

  document.body.append(wrap);
  setTimeout(() => text.focus(), 30);
}
