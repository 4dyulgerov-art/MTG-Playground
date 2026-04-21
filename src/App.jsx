/*  src/App.jsx
    ─────────────────────────────────────────────────────────────────────────
    Top-level router that sits IN FRONT of v6's MTGPlayground.
    Responsibilities:
      1. Handle ?reset=1 magic-link landing → PasswordReset view.
      2. Gate on auth (AuthGate) until signed in.
      3. Load the signed-in profile from Supabase once.
      4. Migrate local decks → cloud (once per device per user) on first login.
      5. Write profile + session into both React state AND a window global
         so the unmodified v6 code can read them via a tiny bridge.
      6. Expose deck cloud save/load to Playground via window.__MTG_V7__.
      7. Render v6's Playground.
*/
import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { getMyProfile, upsertMyProfile } from './lib/profiles';
import { getMyDecksCloud, saveMyDecksCloud, migrateLocalDecksIfNeeded } from './lib/decks';
import { signOut } from './lib/auth';
import AuthGate from './components/auth/AuthGate.jsx';
import PasswordReset from './components/auth/PasswordReset.jsx';
import Playground from './Playground.jsx';

const BG = '#050a12';

function SplashLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 10, color: '#c8a870',
      fontFamily: 'Cinzel, serif', letterSpacing: '.15em',
    }}>
      <div style={{ fontSize: 28, animation: 'floaty 1.8s ease-in-out infinite' }}>⚔</div>
      <div style={{ fontSize: 12 }}>{label}</div>
      <style>{`@keyframes floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }`}</style>
    </div>
  );
}

// Detect ?reset=1 in the URL. We store in state so flipping it off after
// completion re-renders us past the gate.
function useResetFlag() {
  const [on, setOn] = useState(() => {
    try { return new URL(window.location.href).searchParams.get('reset') === '1'; }
    catch { return false; }
  });
  return [on, setOn];
}

export default function App() {
  const { user, loading } = useAuth();
  const [profile, setProfile]       = useState(undefined); // undefined = not loaded
  const [profileError, setProfileError] = useState(null);
  const [resetMode, setResetMode]   = useResetFlag();

  // Load profile once we have a user (unless in reset mode).
  useEffect(() => {
    if (resetMode) return;
    if (!user) { setProfile(undefined); return; }
    let alive = true;
    (async () => {
      try {
        const p = await getMyProfile();
        if (!alive) return;
        setProfile(p || null);
        // Fire-and-forget: migrate local decks to cloud on first login.
        migrateLocalDecksIfNeeded();
      } catch (e) {
        if (!alive) return;
        setProfileError(e.message || String(e));
        setProfile(null);
      }
    })();
    return () => { alive = false; };
  }, [user?.id, resetMode]);

  // Bridge state + deck cloud API → window global for v6 code.
  useEffect(() => {
    window.__MTG_V7__ = window.__MTG_V7__ || {};
    window.__MTG_V7__.user = user || null;
    window.__MTG_V7__.profile = profile || null;
    window.__MTG_V7__.signOut = async () => { await signOut(); };
    window.__MTG_V7__.saveProfile = async (p) => {
      const { data, error } = await upsertMyProfile(p);
      if (error) throw error;
      setProfile(data);
      return data;
    };
    // v7.3: cloud deck API surfaced to Playground.jsx
    window.__MTG_V7__.getDecks  = getMyDecksCloud;
    window.__MTG_V7__.saveDecks = saveMyDecksCloud;
  }, [user, profile]);

  // Sign-out event from within v6.
  useEffect(() => {
    const h = () => signOut();
    window.addEventListener('mtg:signout', h);
    return () => window.removeEventListener('mtg:signout', h);
  }, []);

  // 1. Reset-password mode takes precedence over everything except "still loading".
  if (loading) return <SplashLoader label="AUTHENTICATING…" />;
  if (resetMode && user) {
    return <PasswordReset onDone={() => setResetMode(false)} />;
  }
  if (resetMode && !user) {
    // Link expired or was consumed. Drop out of reset mode.
    setTimeout(() => setResetMode(false), 0);
    return <SplashLoader label="LINK EXPIRED, REDIRECTING…" />;
  }

  if (!user)                  return <AuthGate />;
  if (profile === undefined)  return <SplashLoader label="LOADING PROFILE…" />;

  return (
    <Playground
      authUser={user}
      initialProfile={profile}
      onProfileSaved={async p => {
        await upsertMyProfile(p);
        setProfile(p);
      }}
      onSignOut={() => signOut()}
    />
  );
}
