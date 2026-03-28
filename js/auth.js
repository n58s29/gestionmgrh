// ═══ MGRH Authentication ═══
// Credentials stored as SHA-256 hashes for basic protection.
// NOTE: This is a client-side "courtesy lock" — not enterprise-grade security.
// For production, use Firebase Auth or similar server-side auth.

// ──── CONFIGURATION ────
// To generate new hashes, run in browser console:
//   hashCredential('your_username').then(h => console.log('user:', h))
//   hashCredential('your_password').then(h => console.log('pass:', h))

const AUTH_CONFIG = {
  // Default: admin / mgrh2026
  usernameHash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
  passwordHash: '2a9fba5849b713fc7f80005e01d03bdf8a492db5ce6169b4983dfc78a306d33d'
};

// ──── HASH FUNCTION ────
async function hashCredential(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ──── LOGIN HANDLER ────
async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('loginError');

  const [userHash, passHash] = await Promise.all([
    hashCredential(username),
    hashCredential(password)
  ]);

  if (userHash === AUTH_CONFIG.usernameHash && passHash === AUTH_CONFIG.passwordHash) {
    // Store auth token in sessionStorage (cleared when browser closes)
    const token = await hashCredential(Date.now().toString() + username);
    sessionStorage.setItem('mgrh-auth', token);
    sessionStorage.setItem('mgrh-user', username);
    window.location.href = 'app.html';
  } else {
    errorEl.style.display = 'block';
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
    setTimeout(() => { errorEl.style.display = 'none'; }, 3000);
  }
  return false;
}

// ──── AUTH CHECK (used by app.html) ────
function checkAuth() {
  if (!sessionStorage.getItem('mgrh-auth')) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function logout() {
  sessionStorage.removeItem('mgrh-auth');
  sessionStorage.removeItem('mgrh-user');
  window.location.href = 'index.html';
}

// ──── AUTO-REDIRECT if already logged in ────
if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
  if (sessionStorage.getItem('mgrh-auth')) {
    window.location.href = 'app.html';
  }
}
