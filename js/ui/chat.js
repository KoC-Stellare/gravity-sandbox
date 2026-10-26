import { h, clear } from './dom.js';

/** Small chat box, bottom-left. Enter to type, Enter to send, Esc to cancel. */
export class Chat {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.list = h('div.chat-list');
    this.input = h('input.chat-input', { maxLength: 200, placeholder: 'Press Enter to chat' });
    this.root.append(this.list, this.input);
    this.typing = false;
    this.input.addEventListener('focus', () => { this.typing = true; this.root.classList.add('typing'); });
    this.input.addEventListener('blur', () => { this.typing = false; this.root.classList.remove('typing'); });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.input.value;
        this.input.value = '';
        if (t.trim()) game.sendChat(t);
        this.input.blur();
        game.resume();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.input.blur();
        setTimeout(() => game.resume(), 50);
      }
    });
  }
  show(v) { this.root.classList.toggle('hidden', !v); }
  focus() {
    this.typing = true;
    this.game.input.unlock();
    setTimeout(() => this.input.focus(), 10);
  }
  reset(msgs) { clear(this.list); msgs.forEach((m) => this.add(m)); }
  add(m) {
    const line = m.system
      ? h('div.msg.sys', m.text)
      : h('div.msg', h('b', { style: { color: m.color || '#fff' } }, m.name), ': ', m.text);
    this.list.append(line);
    while (this.list.children.length > 40) this.list.firstChild.remove();
    this.list.scrollTop = this.list.scrollHeight;
    line.classList.add('fresh');
    setTimeout(() => line.classList.remove('fresh'), 8000);
  }
}
