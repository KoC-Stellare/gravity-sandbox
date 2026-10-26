// Element.append() turns null into the text "null"; skip empty values so `cond ? el : null` works everywhere.
const nativeAppend = Element.prototype.append;
Element.prototype.append = function (...items) { return nativeAppend.apply(this, items.flat(Infinity).filter((x) => x != null && x !== false)); };

/** Tiny DOM helper: h('div.cls#id', {attrs}, ...children) */
export function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (s, root = document) => root.querySelector(s);
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

let toastTimer;
export function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = h('div#toast'); document.body.append(t); }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

/** Modal dialog. Returns {el, close}. */
export function modal(title, body, actions = []) {
  const wrap = h('div.modal-wrap');
  const close = () => wrap.remove();
  const box = h('div.modal',
    h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, title: 'Close' }, '✕')),
    h('div.modal-body', body),
    actions.length ? h('div.modal-actions', actions.map((a) => h('button' + (a.primary ? '.btn.primary' : '.btn'), { onclick: () => a.onClick(close) }, a.label))) : null);
  wrap.append(box);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  return { el: box, close };
}

export function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((res) => {
    modal(title, h('p', text), [
      { label: 'Cancel', onClick: (c) => { c(); res(false); } },
      { label: okLabel, primary: true, onClick: (c) => { c(); res(true); } },
    ]);
  });
}

export function promptDialog(title, label, value = '', okLabel = 'Save') {
  return new Promise((res) => {
    const input = h('input.input', { value, maxLength: 40 });
    const m = modal(title, h('label.field', h('span', label), input), [
      { label: 'Cancel', onClick: (c) => { c(); res(null); } },
      { label: okLabel, primary: true, onClick: (c) => { c(); res(input.value.trim()); } },
    ]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { m.close(); res(input.value.trim()); } });
    setTimeout(() => input.focus(), 30);
  });
}
