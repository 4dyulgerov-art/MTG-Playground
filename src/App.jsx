/*  src/App.jsx
    ─────────────────────────────────────────────────────────────────────────
    Top-level router that sits IN FRONT of v6's MTGPlayground.
    Responsibilities:
      1. Gate on auth (AuthGate) until signed in.
      2. Load the signed-in profile from Supabase once.
      3. Write profile + session into both React state AND a window global
         so the unmodified v6 code can read them via a tiny bridge.
      4. Render v6's Playground — which handles profile setup (if null),
         deck builder, room lobby, and game.
      5. Listen for "SIGN_OUT" custom event (Playground fires one) to logout.
*/
import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { getMyProfile, upsertMyProfile } from './lib/profiles';
import { signOut } from './lib/auth';
import AuthGate from './components/auth/AuthGate.jsx';
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

export default function App() {
  const { user, loading } = useAuth();
  const [profile, setProfile]       = useState(undefined); // undefined = not loaded
  const [profileError, setProfileError] = useState(null);

  // Load profile once we have a user.
  useEffect(() => {
    if (!user) { setProfile(undefined); return; }
    let alive = true;
    (async () => {
      try {
        const p = await getMyProfile();
        if (!alive) return;
        setProfile(p || null);
      } catch (e) {
        if (!alive) return;
        setProfileError(e.message || String(e));
        setProfile(null);
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  // Bridge state → window global so v6 code can access without refactor.
  useEffect(() => {
    window.__MTG_V7__ = window.__MTG_V7__ || {};
    window.__MTG_V7__.user = user || null;
    window.__MTG_V7__.profile = profile || null;
    window.__MTG_V7__.signOut = async () => {
      await signOut();
    };
    window.__MTG_V7__.saveProfile = async (p) => {
      const { data, error } = await upsertMyProfile(p);
      if (error) throw error;
      setProfile(data);
      return data;
    };
  }, [user, profile]);

  // Sign-out event from within v6.
  useEffect(() => {
    const h = () => signOut();
    window.addEventListener('mtg:signout', h);
    return () => window.removeEventListener('mtg:signout', h);
  }, []);

  if (loading)                return <SplashLoader label="AUTHENTICATING…" />;
  if (!user)                  return <AuthGate />;
  if (profile === undefined)  return <SplashLoader label="LOADING PROFILE…" />;

  // profile may still be null here (brand-new user) — that's fine, v6's
  // ProfileSetup will render because its `profile` state starts null.
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
