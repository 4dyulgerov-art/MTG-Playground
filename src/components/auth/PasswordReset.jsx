/*  src/components/auth/PasswordReset.jsx
    ─────────────────────────────────────────────────────────────────────────
    Shown when the user arrives at `?reset=1` via the Supabase reset-password
    magic link. At that point Supabase has signed them in with a short-lived
    recovery session — we use that session to call updateUser({password}).
*/
import { useState } from 'react';
import { updatePassword, signOut } from '../../lib/auth';

const ACCENT = '#c8a870';
const BG     = '#050a12';
const PANEL  = '#0a1628';
const BORDER = '#1e3a5f';

const inputS = {
  display: 'block', width: '100%', padding: '10px 12px',
  background: 'rgba(5,10,18,.8)', color: '#e8e2d0',
  border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 14, fontFamily: 'Crimson Text, serif',
  marginTop: 6,
};
const btnPrimary = {
  width: '100%', padding: '11px', marginTop: 14,
  background: `linear-gradient(135deg, ${ACCENT}, #8a6040)`,
  color: BG, border: 'none', borderRadius: 6, cursor: 'pointer',
  fontFamily: 'Cinzel, serif', fontWeight: 700, fontSize: 13,
  letterSpacing: '.08em', textTransform: 'uppercase',
};

export default function PasswordReset({ onDone }) {
  const [pw, setPw]       = useState('');
  const [pw2, setPw2]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const [done, setDone]   = useState(false);

  async function onSubmit(e) {
    e?.preventDefault?.();
    setErr(null);
    if (pw.length < 6)  return setErr('Password must be at least 6 characters.');
    if (pw !== pw2)     return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const { error } = await updatePassword(pw);
      if (error) throw error;
      setDone(true);
      // Clear the ?reset=1 param so a refresh doesn't land here again
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('reset');
        window.history.replaceState({}, '', u.toString());
      } catch {}
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusy(false); }
  }

  async function onContinue() {
    // They're already signed in via the recovery session, so just tell
    // App to re-render by firing the callback. No need to sign out.
    onDone?.();
  }

  async function onSignOutInstead() {
    await signOut();
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('reset');
      window.history.replaceState({}, '', u.toString());
    } catch {}
    onDone?.();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <form onSubmit={onSubmit} style={{
        width: 420, maxWidth: '92vw',
        padding: 32, borderRadius: 14,
        background: `linear-gradient(160deg, ${PANEL}ee, ${BG}fa)`,
        border: `1px solid ${ACCENT}40`,
        boxShadow: '0 30px 100px rgba(0,0,0,.9)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 32, filter: `drop-shadow(0 0 20px ${ACCENT}80)` }}>🔒</div>
          <h1 style={{
            fontFamily: 'Cinzel Decorative, serif',
            fontSize: 20, letterSpacing: '.1em', color: ACCENT,
            marginTop: 6, textShadow: `0 0 20px ${ACCENT}40`,
          }}>SET NEW PASSWORD</h1>
          <div style={{ fontSize: 10, color: '#3a5a7a', letterSpacing: '.2em',
            fontFamily: 'Cinzel, serif', marginTop: 4 }}>
            CHOOSE A NEW SIGIL
          </div>
        </div>

        {!done ? (
          <>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: '#6a7a8a', letterSpacing: '.15em',
                fontFamily: 'Cinzel, serif', textTransform: 'uppercase' }}>New Password</span>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                placeholder="6+ characters" style={inputS} required minLength={6} autoFocus />
            </label>
            <label style={{ display: 'block', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#6a7a8a', letterSpacing: '.15em',
                fontFamily: 'Cinzel, serif', textTransform: 'uppercase' }}>Confirm Password</span>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                placeholder="Re-enter password" style={inputS} required minLength={6} />
            </label>

            {err && <div style={{ marginTop: 14, padding: 10, borderRadius: 6,
              background: 'rgba(220,38,38,.1)', border: '1px solid #dc2626',
              color: '#fca5a5', fontSize: 12 }}>{err}</div>}

            <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? .6 : 1 }}>
              {busy ? '…' : 'Set Password'}
            </button>

            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 11, color: '#6a7a8a' }}>
              <a onClick={onSignOutInstead}
                style={{ color: ACCENT, cursor: 'pointer', textDecoration: 'underline' }}>
                Cancel & sign out
              </a>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: 12, borderRadius: 6,
              background: 'rgba(22,163,74,.1)', border: '1px solid #16a34a',
              color: '#86efac', fontSize: 13, textAlign: 'center' }}>
              Password updated successfully.
            </div>
            <button type="button" onClick={onContinue} style={btnPrimary}>
              Enter the Multiverse
            </button>
          </>
        )}
      </form>
    </div>
  );
}
