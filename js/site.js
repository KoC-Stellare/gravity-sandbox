// Website script (home + download page). The game does not use this file.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- light / dark theme: follows the computer unless the visitor picked one ----
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);
for (const btn of document.querySelectorAll('.theme-btn')) {
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('gs-theme', next); } catch { /* private mode: theme lasts for this page only */ }
  });
}

// ---- sections slide in when they scroll into view ----
const reveals = document.querySelectorAll('.reveal');
if (!reduceMotion && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  reveals.forEach((el) => { el.classList.add('pending'); io.observe(el); });
}

// ---- hero video: still picture only for visitors who prefer less motion ----
const heroVideo = document.querySelector('.hero-media');
if (heroVideo && reduceMotion) { heroVideo.removeAttribute('autoplay'); heroVideo.pause(); }

// ---- power switcher: click a power or press 1–7, like in the game ----
const tabs = [...document.querySelectorAll('.power-tab')];
const video = document.getElementById('power-video');
const cap = document.getElementById('power-cap');

function selectPower(tab, focus = false) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
  const name = tab.dataset.media;
  video.poster = `/img/${name}.webp`;
  video.src = `/video/${name}.mp4`;
  video.setAttribute('aria-label', `${tab.querySelector('b').textContent} in action`);
  if (!reduceMotion && powersVisible) video.play().catch(() => {});
  cap.textContent = `Key ${tab.dataset.key} · ${tab.querySelector('small').textContent}`;
  if (focus) tab.focus();
}

let powersVisible = false;
if (tabs.length) {
  tabs.forEach((t) => t.addEventListener('click', () => selectPower(t)));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName) || !lightbox.hidden) return;
    const tab = tabs.find((t) => t.dataset.key === e.key);
    if (tab) { selectPower(tab); return; }
    const i = tabs.indexOf(document.activeElement);
    if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      selectPower(tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length], true);
    }
  });
  // only download and play the clip while the section is on screen
  new IntersectionObserver(([e]) => {
    powersVisible = e.isIntersecting;
    if (powersVisible && !reduceMotion) video.play().catch(() => {}); else video.pause();
  }).observe(video);
  selectPower(tabs[0]);
}

// ---- gallery + picture viewer ----
const PICTURES = [
  ['gallery-zero-g', 'Gravity switched off in The Lab'],
  ['gallery-flip', 'Body gravity: turning onto the wall'],
  ['gallery-wall', 'Body gravity: walking on the wall'],
  ['gallery-bubble', 'A zero-g bubble in The Yard lifts a stack of barrels'],
  ['gallery-atrium', 'Zero-g in The Atrium'],
  ['gallery-throw', 'Telekinesis: a crate thrown into a pile of boxes'],
  ['gallery-attract', 'Attraction pulls twenty boxes into one floating cluster'],
  ['gallery-crates', 'Object gravity lifts a whole stack of crates'],
  ['gallery-scan', 'Area scan selects everything inside the sphere'],
];
const gallery = document.querySelector('.gallery');
const lightbox = document.querySelector('.lightbox') || { hidden: true };
let current = 0;

function openPicture(i) {
  current = (i + PICTURES.length) % PICTURES.length;
  const [name, text] = PICTURES[current];
  const img = lightbox.querySelector('img');
  img.src = `/img/${name}.webp`;
  img.alt = text;
  lightbox.querySelector('figcaption').textContent = `${current + 1} / ${PICTURES.length} · ${text}`;
  if (lightbox.hidden) { lightbox.hidden = false; document.body.classList.add('no-scroll'); lightbox.querySelector('.lb-close').focus(); }
}
function closePicture() {
  lightbox.hidden = true;
  document.body.classList.remove('no-scroll');
  gallery.children[current]?.focus();
}

if (gallery) {
  PICTURES.forEach(([name, text], i) => {
    const b = document.createElement('button');
    b.className = 'pic';
    b.type = 'button';
    b.setAttribute('aria-label', `Open picture: ${text}`);
    b.innerHTML = `<img src="/img/${name}.webp" alt="" width="1120" height="630" loading="lazy" />`;
    b.addEventListener('click', () => openPicture(i));
    gallery.append(b);
  });
  lightbox.querySelector('.lb-close').addEventListener('click', closePicture);
  lightbox.querySelector('.lb-prev').addEventListener('click', () => openPicture(current - 1));
  lightbox.querySelector('.lb-next').addEventListener('click', () => openPicture(current + 1));
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closePicture(); });
  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closePicture();
    else if (e.key === 'ArrowLeft') openPicture(current - 1);
    else if (e.key === 'ArrowRight') openPicture(current + 1);
  });
}

// ---- download page: latest version and file sizes ----
const meta = document.getElementById('release-meta');
if (meta) {
  fetch('https://api.github.com/repos/KoC-Stellare/gravity-sandbox/releases/latest')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const date = new Date(rel.published_at).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });
      meta.textContent = `Version ${rel.tag_name.replace(/^v/, '')} · released ${date}`;
      meta.hidden = false;
      for (const a of document.querySelectorAll('[data-asset]')) {
        const asset = rel.assets.find((x) => x.name === a.dataset.asset);
        if (asset) a.insertAdjacentHTML('beforeend', ` <span class="size">${Math.round(asset.size / 1048576)} MB</span>`);
      }
    })
    .catch(() => { /* no release info: the buttons still work */ });
}
