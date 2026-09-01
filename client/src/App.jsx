import { useState, useEffect, lazy, Suspense } from 'react';
import AuthScreen from './AuthScreen.jsx';
import Dashboard from './Dashboard.jsx';
import { api } from './api.js';

// Lazy-load heavy WebRTC video calling engine & guest lobby on-demand
const CallScreen = lazy(() => import('./CallScreen.jsx'));
const GuestJoinLobby = lazy(() => import('./GuestJoinLobby.jsx'));

// Speculative preloader function: loads CallScreen chunk into browser cache ahead of time
export function prefetchCallScreen() {
  import('./CallScreen.jsx').catch(() => {});
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('omnicall_token') || null);
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('omnicall_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      localStorage.removeItem('omnicall_user');
      return null;
    }
  });

  const [activeRoom, setActiveRoom] = useState(null);
  const [roomToken, setRoomToken] = useState(null);
  const [inRoomNickname, setInRoomNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [initialBootstrap, setInitialBootstrap] = useState(null);

  // Check if current URL is a guest invite link: e.g. /join/:token
  const [guestInviteToken, setGuestInviteToken] = useState(() => {
    const path = window.location.pathname;
    if (path.startsWith('/join/')) {
      return path.replace('/join/', '').split('/')[0].split('?')[0];
    }
    return null;
  });

  // Auto-validate session on boot using API wrapper so silent refresh works
  useEffect(() => {
    if (token) {
      api.listRooms(token).catch((err) => {
        if (err.message === 'Token expired and refresh failed' || err.message === 'Session expired') {
          handleLogout();
        }
      });
    }
  }, [token]);


  // Speculative prefetch: downloads CallScreen chunk in idle background as soon as user is authenticated
  useEffect(() => {
    if (token && user) {
      if ('requestIdleCallback' in window) {
        const handle = window.requestIdleCallback(prefetchCallScreen, { timeout: 2000 });
        return () => window.cancelIdleCallback(handle);
      } else {
        const timer = setTimeout(prefetchCallScreen, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [token, user]);

  const handleAuthSuccess = (newToken, newUser, refreshToken, bootstrap) => {
    setToken(newToken);
    setUser(newUser);
    if (bootstrap) {
      setInitialBootstrap(bootstrap);
    }
    localStorage.setItem('omnicall_token', newToken);
    if (refreshToken) {
      localStorage.setItem('omnicall_refresh_token', refreshToken);
    }
    localStorage.setItem('omnicall_user', JSON.stringify(newUser));
  };


  const handleUserUpdate = (newUser, newToken, newRefreshToken) => {
    setUser(newUser);
    localStorage.setItem('omnicall_user', JSON.stringify(newUser));
    if (newToken) {
      setToken(newToken);
      localStorage.setItem('omnicall_token', newToken);
    }
    if (newRefreshToken) {
      localStorage.setItem('omnicall_refresh_token', newRefreshToken);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setActiveRoom(null);
    setRoomToken(null);
    localStorage.removeItem('omnicall_token');
    localStorage.removeItem('omnicall_refresh_token');
    localStorage.removeItem('omnicall_user');
  };

  const handleGuestJoinSuccess = ({ room, appToken, roomToken, displayName, guestUser }) => {
    setUser(guestUser);
    setToken(appToken);    // The REST API JWT
    setRoomToken(roomToken); // The LiveKit WebRTC Token
    setInRoomNickname(displayName);
    setActiveRoom(room);
    // Clear URL path back to root without reloading
    window.history.replaceState({}, '', '/');
    setGuestInviteToken(null);
  };

  const handleJoinCall = async (room, customNickname) => {
    setJoining(true);
    const chosenName = (customNickname && customNickname.trim()) ? customNickname.trim() : user.name;
    try {
      const data = await api.getRoomToken(token, room.id, chosenName);
      setRoomToken(data.token);
      setInRoomNickname(data.displayName || chosenName);
      setActiveRoom(room);
    } catch (err) {
      throw err;
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveCall = () => {
    setActiveRoom(null);
    setRoomToken(null);
    // If was guest, reset
    if (user?.role === 'guest') {
      setUser(null);
      setToken(null);
    }
  };

  // If visiting an invite link and not yet in call, show Guest Lobby
  if (guestInviteToken && !roomToken) {
    return (
      <Suspense fallback={
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#a5b4fc', fontSize: '0.95rem', gap: '10px' }}>
          <div style={{ width: 22, height: 22, border: '2.5px solid rgba(165,180,252,0.2)', borderTopColor: '#818cf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span>Loading Meeting Lobby…</span>
        </div>
      }>
        <GuestJoinLobby
          inviteToken={guestInviteToken}
          onGuestJoinSuccess={handleGuestJoinSuccess}
          onGoToLogin={() => {
            window.history.replaceState({}, '', '/');
            setGuestInviteToken(null);
          }}
        />
      </Suspense>
    );
  }

  if (!token || !user) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  if (activeRoom && roomToken) {
    return (
      <Suspense fallback={
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#a5b4fc', gap: '14px' }}>
          <div style={{ width: 32, height: 32, border: '3px solid rgba(165,180,252,0.2)', borderTopColor: '#ec4899', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: '0.95rem', letterSpacing: '0.02em' }}>Entering Video Call Space…</span>
        </div>
      }>
        <CallScreen
          token={token}
          user={user}
          roomData={activeRoom}
          roomToken={roomToken}
          initialDisplayName={inRoomNickname}
          onLeave={handleLeaveCall}
        />
      </Suspense>
    );
  }

  return (
    <Dashboard
      token={token}
      user={user}
      initialBootstrap={initialBootstrap}
      onLogout={handleLogout}
      onJoinCall={handleJoinCall}
      onUserUpdate={handleUserUpdate}
    />
  );
}


