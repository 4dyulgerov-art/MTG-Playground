import { useState, useRef, useEffect } from 'react';
import { signIn, signUp, resetPassword } from '../../lib/auth';
import OAuthButtons from './OAuthButtons.jsx';
import { hasSupabaseConfig } from '../../lib/supabase';

const ACCENT = '#c8a870';
const BG     = '#050a12';
const PANEL  = '#0a1628';
const BORDER = '#1e3a5f';

const inputS = {
  display: 'block', width: '100%', padding: '10px 12px',
  background: 'rgba(5,10,18,.8)', color: '#e8e2d0',
  border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 14, fontFamily: 'Crimson Text, serif',
  marginTop: 6, transition: 'border-color .15s, box-shadow .15s',
};
const btnPrimary = {
  width: '100%', padding: '11px', marginTop: 14,
  background: `linear-gradient(135deg, ${ACCENT}, #8a6040)`,
  color: BG, border: 'none', borderRadius: 6, cursor: 'pointer',
  fontFamily: 'Cinzel, serif', fontWeight: 700, fontSize: 13,
  letterSpacing: '.08em', textTransform: 'uppercase',
  boxShadow: '0 6px 20px rgba(200,168,112,.25)',
};

export default function AuthGate() {
  const [mode, setMode]         = useState('signin'); // signin | signup | reset
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState(null);
  const [err, setErr]           = useState(null);

  const canvasRef = useRef(null);

  // Drifting particles, matches v6 vibe
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
      r: Math.random() * 2 + .5,
      color: [`rgba(200,168,112,${Math.random()*.3+.08})`,
              `rgba(168,85,247,${Math.random()*.2+.04})`,
              `rgba(59,130,246,${Math.random()*.15+.04})`][Math.floor(Math.random()*3)],
    }));
    let raf;
    const draw = () => {
      ctx.clearRect(0,0,c.width,c.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height; if (p.y > c.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fillStyle = p.color; ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  async function onSubmit(e) {
    e?.preventDefault?.();
    setErr(null); setMsg(null); setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email.trim(), password);
        if (error) throw error;
      } else if (mode === 'signup') {
        if (!alias.trim())      throw new Error('Choose a planeswalker alias.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { error } = await signUp(email.trim(), password, alias.trim());
        if (error) throw error;
        setMsg('Check your email to confirm your account, then sign in.');
        setMode('signin');
      } else if (mode === 'reset') {
        const { error } = await resetPassword(email.trim());
        if (error) throw error;
        setMsg('Password reset email sent. Check your inbox.');
        setMode('signin');
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

      <form onSubmit={onSubmit} style={{
        position: 'relative', zIndex: 1,
        width: 420, maxWidth: '92vw',
        padding: 32, borderRadius: 14,
        background: `linear-gradient(160deg, ${PANEL}ee, ${BG}fa)`,
        border: `1px solid ${ACCENT}40`,
        boxShadow: '0 30px 100px rgba(0,0,0,.9), 0 0 80px rgba(200,168,112,.04)',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }} />

        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 32, filter: `drop-shadow(0 0 20px ${ACCENT}80)` }}>⚔</div>
          <h1 style={{
            fontFamily: 'Cinzel Decorative, serif',
            fontSize: 20, letterSpacing: '.1em', color: ACCENT,
            marginTop: 6, textShadow: `0 0 20px ${ACCENT}40`,
          }}>MTG PLAYGROUND</h1>
          <div style={{ fontSize: 10, color: '#3a5a7a', letterSpacing: '.2em',
            fontFamily: 'Cinzel, serif', marginTop: 4 }}>
            {mode === 'signin' ? 'ENTER THE MULTIVERSE'
            : mode === 'signup' ? 'CREATE A PLANESWALKER'
            :                      'RESET THY SIGIL'}
          </div>
        </div>

        {!hasSupabaseConfig && (
          <div style={{
            padding: '10px 12px', marginBottom: 14, borderRadius: 6,
            background: 'rgba(220,38,38,.12)', border: '1px solid #dc2626',
            color: '#fca5a5', fontSize: 12, lineHeight: 1.5,
          }}>
            <b>Supabase not configured.</b> Copy <code>.env.example</code> → <code>.env.local</code>, fill in your
            project URL + anon key, then restart <code>npm run dev</code>.
          </div>
        )}

        {mode === 'signup' && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: '#6a7a8a', letterSpacing: '.15em',
              fontFamily: 'Cinzel, serif', textTransform: 'uppercase' }}>Alias</span>
            <input value={alias} onChange={e => setAlias(e.target.value)}
              placeholder="Your name in the Multiverse"
              style={inputS} autoFocus />
          </label>
        )}

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: '#6a7a8a', letterSpacing: '.15em',
            fontFamily: 'Cinzel, serif', textTransform: 'uppercase' }}>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" style={inputS}
            autoFocus={mode !== 'signup'} required />
        </label>

        {mode !== 'reset' && (
          <label style={{ display: 'block', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#6a7a8a', letterSpacing: '.15em',
              fontFamily: 'Cinzel, serif', textTransform: 'uppercase' }}>Password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? '6+ characters' : '••••••••'}
              style={inputS} required minLength={6} />
          </label>
        )}

        {msg && <div style={{ marginTop: 14, padding: 10, borderRadius: 6,
          background: 'rgba(22,163,74,.1)', border: '1px solid #16a34a',
          color: '#86efac', fontSize: 12 }}>{msg}</div>}
        {err && <div style={{ marginTop: 14, padding: 10, borderRadius: 6,
          background: 'rgba(220,38,38,.1)', border: '1px solid #dc2626',
          color: '#fca5a5', fontSize: 12 }}>{err}</div>}

        <button type="submit" disabled={busy || !hasSupabaseConfig} style={{
          ...btnPrimary, opacity: (busy || !hasSupabaseConfig) ? .6 : 1,
        }}>
          {busy ? '…' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
        </button>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: '#6a7a8a' }}>
          {mode === 'signin' ? (
            <>
              <a onClick={() => { setMode('signup'); setErr(null); }}
                style={{ color: ACCENT, cursor: 'pointer', textDecoration: 'underline' }}>
                Create account
              </a>
              <a onClick={() => { setMode('reset'); setErr(null); }}
                style={{ color: ACCENT, cursor: 'pointer', textDecoration: 'underline' }}>
                Forgot password?
              </a>
            </>
          ) : (
            <a onClick={() => { setMode('signin'); setErr(null); setMsg(null); }}
              style={{ color: ACCENT, cursor: 'pointer', textDecoration: 'underline' }}>
              ← Back to sign in
            </a>
          )}
        </div>

        {/* v7.6.5: OAuth providers — Google + Discord. Only shown on the
            sign-in and sign-up screens; reset-password mode hides them since
            you'd be on the magic-link flow at that point. */}
        {mode !== 'reset' && <OAuthButtons />}
      </form>
    </div>
  );
}
