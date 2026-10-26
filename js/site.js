// Website script (landing + download page). The game does not use this file.

// ---- power switcher: click a power or press 1–7, like in the game ----
const tabs = [...document.querySelectorAll('.power-tab')];
const img = document.getElementById('power-img');
const cap = document.getElementById('power-cap');

function selectPower(tab, focus = false) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
  img.src = `/img/${tab.dataset.img}.webp`;
  img.alt = `${tab.querySelector('b').textContent} in action`;
  cap.textContent = `Key ${tab.dataset.key} · ${tab.querySelector('small').textContent}`;
  if (focus) tab.focus();
}

if (tabs.length) {
  tabs.forEach((t) => t.addEventListener('click', () => selectPower(t)));
  // preload the other screenshots so switching is instant
  window.addEventListener('load', () => tabs.forEach((t) => { new Image().src = `/img/${t.dataset.img}.webp`; }));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
    const tab = tabs.find((t) => t.dataset.key === e.key);
    if (tab) { selectPower(tab); return; }
    const i = tabs.indexOf(document.activeElement);
    if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      selectPower(tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length], true);
    }
  });
  selectPower(tabs[0]);
}

// ---- download page: show the latest version and file size ----
const meta = document.getElementById('release-meta');
if (meta) {
  fetch('https://api.github.com/repos/KoC-Stellare/gravity-sandbox/releases/latest')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const setup = rel.assets.find((a) => a.name === 'GravitySandBox-Setup.exe');
      const date = new Date(rel.published_at).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
      const size = setup ? ` · ${Math.round(setup.size / 1048576)} MB` : '';
      meta.textContent = `Version ${rel.tag_name.replace(/^v/, '')} · ${date}${size} · Windows 10 and 11, 64-bit`;
    })
    .catch(() => { /* keep the static text */ });
}
