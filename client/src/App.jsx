import { useState } from 'react';
import AuthScreen from './AuthScreen.jsx';
import Dashboard from './Dashboard.jsx';
import CallScreen from './CallScreen.jsx';
import { api } from './api.js';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('omnicall_token') || null);
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('omnicall_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeRoom, setActiveRoom] = useState(null);
  const [roomToken, setRoomToken] = useState(null);
  const [inRoomNickname, setInRoomNickname] = useState('');
  const [joining, setJoining] = useState(false);

  const handleAuthSuccess = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('omnicall_token', newToken);
    localStorage.setItem('omnicall_user', JSON.stringify(newUser));
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setActiveRoom(null);
    setRoomToken(null);
    localStorage.removeItem('omnicall_token');
    localStorage.removeItem('omnicall_user');
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
  };

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
      onLogout={handleLogout}
      onJoinCall={handleJoinCall}
    />
  );
}
