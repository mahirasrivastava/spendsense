/* auth.js — login and signup form behaviour: validation, password visibility,
   strength meter, loading and error states. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- show / hide password ---------- */
  $$('[data-pw-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.pwToggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.classList.toggle('showing', show);
      input.focus({ preventScroll: true });
    });
  });

  /* ---------- field errors ---------- */
  const I = (n) => (window.icon ? window.icon(n, 'ico') : '');

  function setError(field, message) {
    const wrap = document.getElementById('f-' + field);
    const slot = document.getElementById('e-' + field);
    if (!wrap || !slot) return;
    wrap.classList.toggle('invalid', Boolean(message));
    slot.innerHTML = message ? I('alert-circle') + `<span>${message}</span>` : '';
  }
  const clearErrors = (fields) => fields.forEach((f) => setError(f, ''));

  function formAlert(message, type = 'error') {
    const el = $('#formAlert');
    if (!el) return;
    el.className = 'form-alert ' + type;
    el.innerHTML = message ? I(type === 'error' ? 'alert-circle' : 'check-circle') + `<span>${message}</span>` : '';
  }

  function loading(on) {
    const btn = $('#submitBtn');
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
  }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // where to land after signing in; only same-site paths are honoured
  function nextTarget() {
    const raw = new URLSearchParams(location.search).get('next');
    return raw && /^\/[^/\\]/.test(raw) ? raw : '/app';
  }

  /* ---------- password strength ---------- */
  const WORDS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const HINTS = ['Use 8+ characters', 'Add length and variety', 'Mix in numbers or symbols',
    'Almost there — add one more type', 'Strong password'];

  function scorePassword(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    if (kinds >= 2) score++;
    if (kinds >= 3) score++;
    if (pw.length < 8) score = Math.min(score, 1);
    return Math.max(1, Math.min(4, score));
  }

  function wireStrength() {
    const input = $('#password'), box = $('#strength');
    if (!input || !box) return;
    input.addEventListener('input', () => {
      const pw = input.value;
      box.hidden = !pw;
      const s = scorePassword(pw);
      box.dataset.score = String(s);
      $('#strengthWord').textContent = WORDS[s];
      $('#strengthHint').textContent = HINTS[s];
    });
  }

  /* ---------- login ---------- */
  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert('');
      clearErrors(['email', 'password']);

      const email = $('#email').value.trim();
      const password = $('#password').value;
      let ok = true;
      if (!email) { setError('email', 'Enter your email address'); ok = false; }
      else if (!EMAIL_RE.test(email)) { setError('email', 'That does not look like a valid email'); ok = false; }
      if (!password) { setError('password', 'Enter your password'); ok = false; }
      if (!ok) { $('.field.invalid input')?.focus(); return; }

      loading(true);
      try {
        const data = await postJSON('/api/auth/login', { email, password });
        formAlert(`Signed in as ${data.user.name}. Taking you to your dashboard…`, 'success');
        window.ssToast && window.ssToast('Welcome back, ' + data.user.name.split(/\s+/)[0]);
        setTimeout(() => { window.location.href = nextTarget(); }, 550);
      } catch (err) {
        loading(false);
        formAlert(err.message);
        window.ssToast && window.ssToast(err.message, 'error');
        $('#password').focus();
      }
    });
  }

  /* ---------- signup ---------- */
  const signupForm = $('#signupForm');
  if (signupForm) {
    wireStrength();

    // confirm-password feedback as soon as both fields have content
    const confirm = $('#confirm'), password = $('#password');
    confirm.addEventListener('input', () => {
      if (!confirm.value) return setError('confirm', '');
      setError('confirm', confirm.value === password.value ? '' : 'Passwords do not match');
    });

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert('');
      clearErrors(['name', 'email', 'password', 'confirm']);

      const name = $('#name').value.trim();
      const email = $('#email').value.trim();
      const pw = password.value;
      const pw2 = confirm.value;

      let ok = true;
      if (!name) { setError('name', 'Enter your full name'); ok = false; }
      else if (name.length < 2) { setError('name', 'That name looks too short'); ok = false; }
      if (!email) { setError('email', 'Enter your email address'); ok = false; }
      else if (!EMAIL_RE.test(email)) { setError('email', 'That does not look like a valid email'); ok = false; }
      if (!pw) { setError('password', 'Choose a password'); ok = false; }
      else if (pw.length < 8) { setError('password', 'Use at least 8 characters'); ok = false; }
      if (!pw2) { setError('confirm', 'Re-enter your password'); ok = false; }
      else if (pw && pw !== pw2) { setError('confirm', 'Passwords do not match'); ok = false; }
      if (!ok) { $('.field.invalid input')?.focus(); return; }

      loading(true);
      try {
        const data = await postJSON('/api/auth/signup', { name, email, password: pw });
        formAlert(`Account created. Welcome, ${data.user.name}!`, 'success');
        window.ssToast && window.ssToast('Account created');
        setTimeout(() => { window.location.href = nextTarget(); }, 650);
      } catch (err) {
        loading(false);
        formAlert(err.message);
        window.ssToast && window.ssToast(err.message, 'error');
        if (/already exists/i.test(err.message)) {
          setError('email', 'This email is already registered');
          $('#email').focus();
        }
      }
    });
  }
})();
