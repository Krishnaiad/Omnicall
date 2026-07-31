import { useEffect, useState, useRef } from 'react';
import { api } from './api.js';
import { io } from 'socket.io-client';
import { LogOut, Plus, UserPlus, Video, Film, Upload, Trash2, UserCheck, X, Image as ImageIcon, Music, Users, Shield, Bell } from 'lucide-react';

export default function Dashboard({ token, user, onLogout, onJoinCall }) {
  const [rooms, setRooms] = useState([]);
  const [clips, setClips] = useState([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [inviteEmail, setInviteEmail] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Real-time Invite Notice Banner
  const [inviteNotice, setInviteNotice] = useState(null);

  // Admin User Directory Modal State
  const [showAdminDirectory, setShowAdminDirectory] = useState(false);
  const [adminUsersList, setAdminUsersList] = useState([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);

  // Join Call Nickname Modal State
  const [joiningRoom, setJoiningRoom] = useState(null);
  const [customNickname, setCustomNickname] = useState('');

  const socketRef = useRef(null);
  const isAdmin = user && user.role === 'admin';

  const fetchRooms = async () => {
    try {
      const data = await api.listRooms(token);
      setRooms(data.rooms || []);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    } finally {
      setLoadingRooms(false);
    }
  };

  const fetchClips = async () => {
    try {
      const data = await api.listClips(token);
      setClips(data.clips || []);
    } catch (err) {
      console.error('Failed to list media clips:', err);
    }
  };

  const fetchAdminUsers = async () => {
    if (!isAdmin) return;
    setLoadingAdminUsers(true);
    try {
      const data = await api.listUsers(token);
      setAdminUsersList(data.users || []);
    } catch (err) {
      setError(`Admin Error: ${err.message}`);
    } finally {
      setLoadingAdminUsers(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    fetchClips();

    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const socket = io(serverUrl, { auth: { token } });
    socketRef.current = socket;

    socket.on('room-invited-notice', (data) => {
      if (data.inviteeUserId === user.id) {
        setInviteNotice(`🎉 You were invited to room: "${data.roomName}"!`);
        fetchRooms();
        setTimeout(() => setInviteNotice(null), 5000);
      }
    });

    const interval = setInterval(() => {
      fetchRooms();
    }, 5000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [token, user.id]);

  const handleOpenAdminDirectory = () => {
    setShowAdminDirectory(true);
    fetchAdminUsers();
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setError('');
    setSuccess('');
    try {
      await api.createRoom(token, newRoomName.trim());
      setNewRoomName('');
      setSuccess('Room created successfully!');
      fetchRooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteRoom = async (roomId, roomName) => {
    if (!window.confirm(`Are you sure you want to permanently delete room "${roomName}"?`)) return;
    setError('');
    setSuccess('');
    try {
      await api.deleteRoom(token, roomId);
      setSuccess(`Room "${roomName}" deleted successfully.`);
      fetchRooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLeaveRoom = async (roomId, roomName) => {
    if (!window.confirm(`Are you sure you want to leave room "${roomName}"?`)) return;
    setError('');
    setSuccess('');
    try {
      await api.leaveRoom(token, roomId);
      setSuccess(`Left room "${roomName}".`);
      fetchRooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleInvite = async (roomId) => {
    const email = (inviteEmail[roomId] || '').trim();
    if (!email) return;
    setError('');
    setSuccess('');
    try {
      await api.inviteToRoom(token, roomId, email);
      setInviteEmail((prev) => ({ ...prev, [roomId]: '' }));
      setSuccess(`Invited ${email} to room successfully!`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUploadClip = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('clip', selectedFile);

    try {
      await api.uploadClip(token, formData);
      setSelectedFile(null);
      setSuccess('Media file uploaded successfully!');
      fetchClips();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClip = async (id) => {
    try {
      await api.deleteClip(token, id);
      fetchClips();
    } catch (err) {
      setError(err.message);
    }
  };

  const promptJoin = (room) => {
    setJoiningRoom(room);
    setCustomNickname(user.name);
  };

  const confirmJoin = (e) => {
    e.preventDefault();
    if (!joiningRoom) return;
    onJoinCall(joiningRoom, customNickname.trim() || user.name);
    setJoiningRoom(null);
  };

  const getMediaIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return <ImageIcon size={18} color="#ec4899" />;
    if (mimeType.startsWith('audio/')) return <Music size={18} color="#10b981" />;
    return <Film size={18} color="#818cf8" />;
  };

  return (
    <div className="dashboard-layout">
      <nav className="glass-card dashboard-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Video size={28} color="#818cf8" />
          <span className="brand-title">OmniCall Workspace</span>
          {isAdmin && (
            <span style={{ fontSize: '0.75rem', background: 'rgba(236, 72, 153, 0.2)', color: '#f472b6', border: '1px solid rgba(236, 72, 153, 0.4)', padding: '2px 8px', borderRadius: '9999px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Shield size={12} /> Admin Mode
            </span>
          )}
        </div>
        <div className="user-badge">
          {isAdmin && (
            <button
              className="btn-outline"
              onClick={handleOpenAdminDirectory}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(236, 72, 153, 0.4)', color: '#f472b6' }}
            >
              <Users size={16} /> User Directory
            </button>
          )}
          <span className="user-info">Signed in as <strong>{user.name}</strong> ({user.username ? `@${user.username}` : user.email})</span>
          <button className="btn-outline" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      {/* Real-time Invite Toast Banner */}
      {inviteNotice && (
        <div className="error-banner" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(236, 72, 153, 0.9))', color: '#fff', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={18} /> {inviteNotice}
        </div>
      )}

      {error && <div className="error-banner" style={{ marginBottom: '20px' }}>{error}</div>}
      {success && <div className="error-banner" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#6ee7b7', marginBottom: '20px' }}>{success}</div>}

      <div className="dash-sections">
        {/* Rooms Section */}
        <div className="glass-card section-box">
          <div className="section-title">
            <Video size={20} color="#818cf8" />
            <span>Your Video Rooms</span>
          </div>

          <form onSubmit={handleCreateRoom} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <input
              className="form-control"
              placeholder="New unique room name (e.g. Design Sync)"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              maxLength={80}
            />
            <button type="submit" className="btn-primary" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <Plus size={18} /> Create
            </button>
          </form>

          {loadingRooms ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading rooms...</p>
          ) : rooms.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No rooms joined yet. Create one above!</p>
          ) : (
            <div>
              {rooms.map((room) => (
                <div key={room.id} className="room-item">
                  <div className="room-main">
                    <div>
                      <span className="room-name">{room.name}</span>
                      <span className={`role-badge ${room.role === 'owner' ? 'role-owner' : 'role-member'}`}>
                        {room.role}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn-primary"
                        style={{ width: 'auto', padding: '6px 14px', fontSize: '0.875rem' }}
                        onClick={() => promptJoin(room)}
                      >
                        Join Call
                      </button>

                      {room.role === 'owner' ? (
                        <button
                          className="btn-outline"
                          onClick={() => handleDeleteRoom(room.id, room.name)}
                          title="Delete Room permanently (Owner Only)"
                          style={{ padding: '6px 10px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <button
                          className="btn-outline"
                          onClick={() => handleLeaveRoom(room.id, room.name)}
                          title="Leave Room"
                          style={{ padding: '6px 10px', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)' }}
                        >
                          <LogOut size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {room.role === 'owner' && (
                    <div className="invite-row">
                      <input
                        className="form-control"
                        placeholder="Invite member by username or email"
                        style={{ fontSize: '0.8125rem', padding: '6px 10px' }}
                        value={inviteEmail[room.id] || ''}
                        onChange={(e) => setInviteEmail((prev) => ({ ...prev, [room.id]: e.target.value }))}
                      />
                      <button
                        className="btn-outline"
                        style={{ padding: '6px 12px', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleInvite(room.id)}
                      >
                        <UserPlus size={14} /> Invite
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Server Media Library Section */}
        <div className="glass-card section-box">
          <div className="section-title">
            <Film size={20} color="#ec4899" />
            <span>Server Media Library</span>
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Upload Images (PNG, JPG, WEBP), Videos (MP4), or Audio (MP3) here. Stream in-call into your tile or broadcast to the Presentation Stage!
          </p>

          <form onSubmit={handleUploadClip} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp3,audio/wav"
              className="form-control"
              style={{ fontSize: '0.8125rem', padding: '6px' }}
              onChange={(e) => setSelectedFile(e.target.files[0])}
            />
            <button type="submit" className="btn-primary" disabled={!selectedFile || uploading} style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </form>

          {clips.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No media uploaded yet.</p>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {clips.map((clip) => (
                <div key={clip.id} className="room-item" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {getMediaIcon(clip.mimeType)}
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{clip.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{clip.mimeType} • {clip.status}</div>
                    </div>
                  </div>

                  <button
                    className="btn-outline"
                    onClick={() => handleDeleteClip(clip.id)}
                    style={{ padding: '4px 8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Admin User Directory Modal */}
      {showAdminDirectory && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box" style={{ width: '540px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.125rem', color: '#f472b6' }}>
                <Shield size={20} /> Registered Accounts Directory (Admin Only)
              </div>
              <button onClick={() => setShowAdminDirectory(false)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {loadingAdminUsers ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Loading accounts database...</p>
            ) : (
              <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px' }}>Name</th>
                      <th style={{ padding: '8px' }}>Email</th>
                      <th style={{ padding: '8px' }}>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsersList.map((u) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '10px 8px', fontWeight: 500 }}>{u.name}</td>
                        <td style={{ padding: '10px 8px', color: '#a5b4fc' }}>{u.email}</td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{ fontSize: '0.75rem', background: u.role === 'admin' ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.1)', color: u.role === 'admin' ? '#f472b6' : 'var(--text-muted)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                            {u.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Join Call Nickname Modal */}
      {joiningRoom && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box" style={{ width: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 600 }}>Join {joiningRoom.name}</span>
              <button onClick={() => setJoiningRoom(null)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={confirmJoin}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Display Name in Call</label>
                <input
                  className="form-control"
                  value={customNickname}
                  onChange={(e) => setCustomNickname(e.target.value)}
                  maxLength={50}
                  required
                />
              </div>
              <button type="submit" className="btn-primary">
                Confirm & Join
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
