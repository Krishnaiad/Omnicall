import { useState, useEffect } from 'react';
import AuthScreen from './AuthScreen.jsx';
import Dashboard from './Dashboard.jsx';
import CallScreen from './CallScreen.jsx';
import GuestJoinLobby from './GuestJoinLobby.jsx';
import { api } from './api.js';

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

  // Auto-validate session on boot. If user was deleted or token expired, cleanly return to login
  useEffect(() => {
    if (token) {
      fetch(`${api.BASE_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then((res) => {
        if (res.status === 401) {
          handleLogout();
        }
      }).catch(() => {});
    }
  }, [token]);


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

  const handleGuestJoinSuccess = ({ room, roomToken: gToken, displayName, guestUser }) => {
    setUser(guestUser);
    setToken(gToken);
    setRoomToken(gToken);
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
      alert(`Could not join room call: ${err.message}`);
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
      <GuestJoinLobby
        inviteToken={guestInviteToken}
        onGuestJoinSuccess={handleGuestJoinSuccess}
        onGoToLogin={() => {
          window.history.replaceState({}, '', '/');
          setGuestInviteToken(null);
        }}
      />
    );
  }

  if (!token || !user) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  if (activeRoom && roomToken) {
    return (
      <CallScreen
        token={token}
        user={user}
        roomData={activeRoom}
        roomToken={roomToken}
        initialDisplayName={inRoomNickname}
        onLeave={handleLeaveCall}
      />
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


