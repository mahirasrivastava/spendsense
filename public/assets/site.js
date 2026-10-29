/* site.js — shared chrome: floating navbar, mobile menu, auth state,
   scroll reveal, theme and toasts. Loaded on every page. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- theme ---------------- */
  const stored = (() => { try { return localStorage.getItem('ss-theme'); } catch { return null; } })();
  document.documentElement.dataset.theme =
    stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  window.ssToggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ss-theme', next); } catch {}
    document.dispatchEvent(new CustomEvent('ss:theme', { detail: next }));
  };

  /* ---------------- toast ---------------- */
  window.ssToast = (msg, type = 'success') => {
    let t = $('#ssToast');
    if (!t) { t = document.createElement('div'); t.id = 'ssToast'; t.className = 'toast'; document.body.appendChild(t); }
    t.className = 'toast ' + type;
    t.innerHTML = (window.icon ? window.icon(type === 'error' ? 'alert-circle' : 'check-circle', 'ico ico-sm') : '')
      + `<span>${esc(msg)}</span>`;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ---------------- auth state ---------------- */
  let me = null;
  const authReady = fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => r.json()).then((d) => { me = d.user; return me; })
    .catch(() => null);
  window.ssAuthReady = authReady;
  window.ssUser = () => me;

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.ssToast('Signed out');
      setTimeout(() => { window.location.href = '/'; }, 400);
    } catch { window.ssToast('Could not sign out', 'error'); }
  }
  window.ssLogout = logout;

  const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  function authMarkup(user, mobile) {
    const I = window.icon;
    if (!user) {
      return `<a class="btn ghost ${mobile ? 'block' : ''}" href="/login">Log in</a>
              <a class="btn primary ${mobile ? 'block' : ''}" href="/signup">Get started ${I('arrow-right', 'ico ico-sm')}</a>`;
    }
    if (mobile) {
      return `<a class="btn ${'block'}" href="/app">${I('layout-grid', 'ico ico-sm')} Dashboard</a>
              <button class="btn ghost block" data-logout>${I('log-out', 'ico ico-sm')} Log out</button>`;
    }
    return `<div class="profile" id="profileMenu">
        <button class="profile-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false">
          <span class="avatar sm">${esc(initials(user.name))}</span>
          <span class="profile-name">${esc(user.name.split(/\s+/)[0])}</span>
          ${I('chevron-down', 'ico ico-sm')}
        </button>
        <div class="profile-menu" id="profileDrop" role="menu">
          <div class="profile-head"><strong>${esc(user.name)}</strong><span>${esc(user.email)}</span></div>
          <a role="menuitem" href="/app">${I('layout-grid')} Dashboard</a>
          <button role="menuitem" data-logout>${I('log-out')} Log out</button>
        </div>
      </div>`;
  }

  function wireProfile(scope) {
    $$('[data-logout]', scope).forEach((b) => b.onclick = logout);
    const btn = $('#profileBtn', scope), drop = $('#profileDrop', scope);
    if (!btn || !drop) return;
    const close = () => { drop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ---------------- navbar ---------------- */
  function initNav() {
    const wrap = $('#navWrap');
    if (!wrap) return;
    const bar = $('#navbar', wrap);
    const toggle = $('#navToggle', wrap);
    const mobile = $('#navMobile', wrap);

    // condense on scroll
    const onScroll = () => wrap.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // active link for the current page / section
    const here = location.pathname.replace(/\/$/, '') || '/';
    $$('a', $('#navLinks', wrap) || bar).forEach((a) => {
      const url = new URL(a.getAttribute('href'), location.origin);
      if (url.pathname.replace(/\/$/, '') === here && !url.hash) a.classList.add('active');
    });

    // mobile menu
    const setOpen = (open) => {
      wrap.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mobile.hidden = !open;
      document.body.style.overflow = open ? 'hidden' : '';
    };
    toggle.onclick = () => setOpen(!wrap.classList.contains('menu-open'));
    mobile.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 860) setOpen(false); });
    setOpen(false);

    // in-page anchors scroll smoothly and clear the floating bar
    $$('a[href^="/#"], a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').split('#')[1];
        const target = id && document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top, behavior: reduced.matches ? 'auto' : 'smooth' });
        history.replaceState(null, '', '#' + id);
      });
    });

  }

  function fillAuthAreas() {
    authReady.then((user) => {
      const desktop = $('#navAuth');
      const mob = $('#navMobileAuth');
      if (desktop) { desktop.innerHTML = authMarkup(user, false); wireProfile(desktop); }
      if (mob) { mob.innerHTML = authMarkup(user, true); wireProfile(mob); }
      $('#navWrap')?.classList.add('ready');
      document.dispatchEvent(new CustomEvent('ss:auth', { detail: user }));
    });
  }

  /* ---------------- scroll reveal ---------------- */
  function initReveal() {
    const items = $$('[data-reveal]');
    if (!items.length) return;
    if (reduced.matches || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        // stagger siblings within the same group for a settled, non-jumpy entrance
        const delay = Number(el.dataset.reveal) || 0;
        el.style.transitionDelay = delay + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    fillAuthAreas();
    initReveal();
    $$('[data-theme-toggle]').forEach((b) => b.onclick = window.ssToggleTheme);
  });
})();
