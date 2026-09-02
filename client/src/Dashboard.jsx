import { useEffect, useState, useRef } from 'react';
import { api } from './api.js';
import { prefetchCallScreen } from './App.jsx';
import { LogOut, Plus, UserPlus, Video, Film, Upload, Trash2, Users, Shield, Bell, Activity, Radio, AlertTriangle, X, UserCheck, Edit3, Cloud, HardDrive, Image as ImageIcon, Download, Search, CheckCircle2, Sparkles, Camera, Eye, Sun, Moon, User } from 'lucide-react';

export default function Dashboard({ token, user, initialBootstrap, onLogout, onJoinCall, onUserUpdate }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  };
  const [rooms, setRooms] = useState(() => initialBootstrap?.rooms || []);
  const [clips, setClips] = useState(() => {
    const raw = initialBootstrap?.clips || [];
    return Array.from(new Map(raw.map((c) => [c.id, c])).values());
  });
  const [memories, setMemories] = useState(() => initialBootstrap?.memories || []);
  const [newRoomName, setNewRoomName] = useState('');
  const [inviteEmail, setInviteEmail] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(() => !initialBootstrap);
  const [loadingMemories, setLoadingMemories] = useState(() => !initialBootstrap);
  const [uploading, setUploading] = useState(false);


  // Real-time Invite Notice Banner
  const [inviteNotice, setInviteNotice] = useState(null);

  // Admin User Directory Modal State
  const [showAdminDirectory, setShowAdminDirectory] = useState(false);
  const [adminUsersList, setAdminUsersList] = useState([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);

  // Profile Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editUsername, setEditUsername] = useState(user?.username || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileModalError, setProfileModalError] = useState('');
  const [profileModalSuccess, setProfileModalSuccess] = useState('');

  // Media Preview Modal State
  const [selectedMediaPreview, setSelectedMediaPreview] = useState(null);

  // Fullscreen Memory View Modal State
  const [selectedMemoryView, setSelectedMemoryView] = useState(null);


  // Join Call Nickname Modal State
  const [joiningRoom, setJoiningRoom] = useState(null);
  const [customNickname, setCustomNickname] = useState('');

  // Delete Room Modal State
  const [deletingRoomTarget, setDeletingRoomTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Leave Room Modal State
  const [leavingRoomTarget, setLeavingRoomTarget] = useState(null);
  const [leaving, setLeaving] = useState(false);

  const eventSourceRef = useRef(null);
  const isAdmin = user && user.role === 'admin';

  // System Health Metrics State (Admin Only)
  const [healthMetrics, setHealthMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const fetchHealthMetrics = async () => {
    if (!isAdmin) return;
    setLoadingMetrics(true);
    try {
      const data = await api.get('/api/admin/health-metrics', token);
      setHealthMetrics(data);
    } catch (err) {
      console.warn('Failed to fetch health metrics:', err.message);
    } finally {
      setLoadingMetrics(false);
    }
  };

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
      const rawClips = data.clips || [];
      const uniqueClips = Array.from(new Map(rawClips.map((c) => [c.id, c])).values());
      setClips(uniqueClips);
    } catch (err) {
      console.error('Failed to list media clips:', err);
    }
  };


  const fetchMemories = async () => {
    try {
      const data = await api.getMemories(token);
      setMemories(data.memories || []);
    } catch (err) {
      console.error('Failed to list memories:', err);
    } finally {
      setLoadingMemories(false);
    }
  };

  const fetchAdminUsers = async () => {
    setLoadingAdminUsers(true);
    try {
      const data = await api.listUsers(token);
      setAdminUsersList(data.users || []);
    } catch (err) {
      setError(`Directory Error: ${err.message}`);
    } finally {
      setLoadingAdminUsers(false);
    }
  };

  const handleAdminDeleteUser = async (targetUser) => {
    if (!window.confirm(`Are you sure you want to delete user @${targetUser.username || targetUser.name}? All their rooms and files will be removed.`)) {
      return;
    }
    setError('');
    setSuccess('');
    try {
      await api.deleteUser(token, targetUser.id);
      setAdminUsersList((prev) => prev.filter((u) => u.id !== targetUser.id));
      setSuccess(`User @${targetUser.username || targetUser.name} deleted successfully.`);
    } catch (err) {
      setError(err.message);
    }
  };



  useEffect(() => {
    if (!initialBootstrap) {
      Promise.all([
        fetchRooms(),
        fetchClips(),
        fetchMemories(),
      ]);
    }


    let es = null;
    try {
      if (token) {
        const sseUrl = `${api.BASE_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;
        es = new EventSource(sseUrl);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'ROOM_INVITED') {
              setInviteNotice(`🎉 ${data.invitedBy} invited you to room: "${data.roomName}"!`);
              fetchRooms();
              setTimeout(() => setInviteNotice(null), 6000);
            }
          } catch (err) {
            console.warn('SSE message parse error:', err);
          }
        };

        es.onerror = () => {
          // Gracefully close on error to avoid mobile browser exceptions
          try { es?.close(); } catch (_) {}
        };
      }
    } catch (sseErr) {
      console.warn('SSE initialization note:', sseErr);
    }

    const interval = setInterval(() => {
      fetchRooms();
      if (isAdmin) fetchHealthMetrics();
    }, 15000);

    if (isAdmin && !healthMetrics) fetchHealthMetrics();

    return () => {
      if (es) {
        try { es.close(); } catch (_) {}
      }
      clearInterval(interval);
    };
  }, [token, user?.id]);


  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 5000);
      return () => clearTimeout(t);
    }
  }, [success]);

  const handleOpenAdminDirectory = () => {
    setShowAdminDirectory(true);
    fetchAdminUsers();
  };

  const handleOpenProfileModal = () => {
    setEditName(user?.name || '');
    setEditUsername(user?.username || '');
    setProfileModalError('');
    setProfileModalSuccess('');
    setShowProfileModal(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!editName.trim() || !editUsername.trim()) return;

    const cleanName = editName.trim();
    const cleanUsername = editUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const currentName = (user?.name || '').trim();
    const currentUsername = (user?.username || '').trim().toLowerCase();

    setProfileModalError('');
    setProfileModalSuccess('');

    // If nothing changed, confirm saved immediately without redundant API call
    if (cleanName === currentName && cleanUsername === currentUsername) {
      setProfileModalSuccess('Saved (no changes made).');
      setSuccess('Profile saved (no changes).');
      setTimeout(() => setShowProfileModal(false), 900);
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch(`${api.BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: cleanName, username: cleanUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');

      setProfileModalSuccess(`✅ Changes saved successfully! Updated to @${data.user.username}`);
      setSuccess(`✅ Changes saved successfully! Updated to @${data.user.username}`);
      if (onUserUpdate) onUserUpdate(data.user, data.token, data.refreshToken);
      setTimeout(() => setShowProfileModal(false), 1100);
    } catch (err) {
      setProfileModalError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };


  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
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
      setPreviewUrl(null);
      setSuccess('✅ Media uploaded to Cloud storage successfully!');
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
      setSuccess('Media deleted.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAllClips = async () => {
    if (!window.confirm('Delete all uploaded media files?')) return;
    try {
      await api.deleteAllClips(token);
      setClips([]);
      setSuccess('All media clips deleted.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteMemory = async (id) => {
    try {
      await api.deleteMemory(token, id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedMemoryView?.id === id) setSelectedMemoryView(null);
      setSuccess('Memory snapshot deleted.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateRoom = async (e) => {

    e.preventDefault();
    if (!newRoomName.trim()) return;
    setError('');
    setSuccess('');
    try {
      await api.createRoom(token, newRoomName.trim());
      setNewRoomName('');
      setSuccess(`Room "${newRoomName.trim()}" created successfully!`);
      fetchRooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleInvite = async (roomId) => {
    const identifier = (inviteEmail[roomId] || '').trim();
    if (!identifier) return;
    setError('');
    setSuccess('');
    try {
      await api.inviteToRoom(token, roomId, identifier);
      setInviteEmail((prev) => ({ ...prev, [roomId]: '' }));
      setSuccess(`Invited ${identifier} successfully!`);
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDeleteRoom = async () => {
    if (!deletingRoomTarget) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteRoom(token, deletingRoomTarget.id);
      setDeletingRoomTarget(null);
      setSuccess(`Room "${deletingRoomTarget.name}" deleted.`);
      fetchRooms();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const confirmLeaveRoom = async () => {
    if (!leavingRoomTarget) return;
    setLeaving(true);
    setError('');
    try {
      await api.leaveRoom(token, leavingRoomTarget.id);
      setLeavingRoomTarget(null);
      setSuccess(`Left room "${leavingRoomTarget.name}".`);
      fetchRooms();
    } catch (err) {
      setError(err.message);
    } finally {
      setLeaving(false);
    }
  };

  const promptJoin = (room) => {
    setJoiningRoom(room);
    setCustomNickname(user?.name || '');
  };


  const confirmJoin = async (e) => {
    e.preventDefault();
    if (!joiningRoom) return;
    try {
      await onJoinCall(joiningRoom, customNickname.trim() || user.name);
      setJoiningRoom(null);
    } catch (err) {
      setError(`Could not join room: ${err.message}`);
    }
  };


  return (

    <div className="dashboard-layout">
      {/* Top Responsive Navbar */}
      <nav className="dashboard-nav glass-card">
        {/* Left Side: Brand Logo & Status */}
        <div className="brand-header-box">
          <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '0.5px solid var(--border)', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Video size={22} />
          </div>
          <div>
            <div className="brand-title">OmniCall Workspace</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span className="live-dot" style={{ width: '6px', height: '6px' }} /> Real-time WebRTC platform
            </div>
          </div>
        </div>

        {/* Right Side: Cleanly Aligned Actions Toolbar (No floating center buttons) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {isAdmin && (
            <button
              className="admin-directory-btn"
              onClick={handleOpenAdminDirectory}
              title="Open User Directory (Admin only)"
            >
              <Users size={16} />
              <span>User directory</span>
            </button>
          )}

          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            aria-label="Toggle dark/light theme"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div style={{ width: '1px', height: '22px', background: 'var(--border-strong)', margin: '0 2px' }} />

          {/* Profile Pill Button (Sleek single-line layout, round avatar) */}
          <button
            className="user-profile-btn"
            onClick={handleOpenProfileModal}
            title="Account profile & settings"
          >
            <div className="avatar-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', fontWeight: 600, background: 'var(--accent)', color: '#ffffff', border: 'none' }}>
              {(user?.name || user?.username || 'U').slice(0, 2).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {user?.name || `@${user?.username || 'user'}`}
            </span>
            {isAdmin && (
              <span className="neutral-badge" style={{ fontSize: '0.65rem', padding: '1px 6px', background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'transparent', fontWeight: 600 }}>
                Admin
              </span>
            )}
          </button>

          <button
            className="btn-outline"
            onClick={onLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem' }}
            title="Logout of OmniCall"
          >
            <LogOut size={15} />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Quick Stat Cards */}
      <div className="dash-stats">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Active rooms</span>
            <div className="stat-icon-box">
              <Video size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{rooms.length}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Ready for video calls</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Media clips</span>
            <div className="stat-icon-box">
              <Film size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{clips.length}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Streamable files</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Room memories</span>
            <div className="stat-icon-box">
              <Camera size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{memories.length}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Saved call snapshots</div>
        </div>
      </div>

      {/* Floating Notifications Toast Container */}
      {(inviteNotice || error || success) && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px', width: 'calc(100% - 48px)' }}>
          {inviteNotice && (
            <div className="glass-card" style={{ padding: '12px 16px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(236, 72, 153, 0.95))', color: '#fff', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <Bell size={18} /> <span>{inviteNotice}</span>
            </div>
          )}
          {error && (
            <div className="glass-card" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.95)', color: '#fff', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <AlertTriangle size={18} /> <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="glass-card" style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.95)', color: '#fff', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <CheckCircle2 size={18} /> <span>{success}</span>
            </div>
          )}
        </div>
      )}


      {/* Main Grid: Video Rooms + Media Injector */}
      <div className="dash-sections">
        {/* Video Rooms Box */}
        <div className="glass-card section-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
              <Video size={20} color="var(--text-muted)" /> Your video rooms
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Unique names enforced</span>
          </div>

          <form onSubmit={handleCreateRoom} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input
              className="form-control"
              placeholder="Create new unique room name..."
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              maxLength={80}
              style={{ borderRadius: '10px' }}
            />
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 20px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <Plus size={18} /> Create
            </button>
          </form>

          {loadingRooms ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading rooms...</p>
          ) : rooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Video size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No rooms joined yet. Create one above to get started!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rooms.map((room) => (
                <div key={room.id} className="room-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {room.active_count > 0 ? (
                        <>
                          <span className="live-dot" title={`${room.active_count} participant(s) live`} />
                          <span className="room-name-text" style={{ fontSize: '0.95rem', fontWeight: 500 }}>{room.name}</span>
                          <span className="badge" style={{ color: 'var(--success)', background: 'var(--success-bg)', border: '1px solid rgba(22,163,74,0.2)' }}>
                            {room.active_count} live
                          </span>
                        </>
                      ) : (
                        <>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }} title="No one in room" />
                          <span className="room-name-text" style={{ fontSize: '0.95rem', fontWeight: 500 }}>{room.name}</span>
                          <span className="badge" style={{ color: 'var(--danger)', background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', fontSize: '0.7rem' }}>
                            No one in room
                          </span>
                        </>
                      )}
                      <span className="badge" style={{ textTransform: 'capitalize' }}>
                        {room.role}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn-join"
                        onClick={() => promptJoin(room)}
                        onMouseEnter={prefetchCallScreen}
                        onFocus={prefetchCallScreen}
                      >
                        <Video size={14} /> Join call
                      </button>

                      {room.role === 'owner' ? (
                        <button
                          className="btn-delete"
                          onClick={() => setDeletingRoomTarget(room)}
                          title="Delete room"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <button
                          className="btn-ghost"
                          onClick={() => setLeavingRoomTarget(room)}
                          title="Leave room"
                          style={{ color: 'var(--warning)' }}
                        >
                          <LogOut size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {room.role === 'owner' && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <input
                        className="form-control"
                        placeholder="Invite user by username or email..."
                        style={{ fontSize: '0.8125rem' }}
                        value={inviteEmail[room.id] || ''}
                        onChange={(e) => setInviteEmail((prev) => ({ ...prev, [room.id]: e.target.value }))}
                      />
                      <button
                        className="btn-outline"
                        style={{ padding: '6px 12px', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
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

        {/* Server Media Library Box */}
        <div className="glass-card section-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
              <Film size={20} color="var(--text-muted)" /> Media library
            </div>
            {clips.length > 0 && (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleDeleteAllClips}
                style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '4px 8px' }}
              >
                <Trash2 size={12} /> Clear all
              </button>
            )}
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Upload images, videos, or audio to stream directly into your call tile.
          </p>

          <form onSubmit={handleUploadClip} style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
              <label style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px dashed var(--border-strong)',
                background: 'var(--surface-raised)',
                color: selectedFile ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                overflow: 'hidden',
                minWidth: 0,
              }}>
                <Upload size={15} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFile ? selectedFile.name : 'Choose file to upload...'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp3,audio/wav"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </label>
              <button
                type="submit"
                className="btn-primary"
                disabled={!selectedFile || uploading}
                style={{ width: 'auto', whiteSpace: 'nowrap' }}
              >
                <Upload size={15} /> {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            {/* Instant Upload Preview Card */}
            {previewUrl && selectedFile && (
              <div style={{ marginTop: '10px', padding: '10px', background: 'var(--surface-raised)', borderRadius: '8px', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {selectedFile.type.startsWith('image/') ? (
                  <img src={previewUrl} alt="Preview" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px' }} />
                ) : (
                  <video src={previewUrl} style={{ width: '56px', height: '42px', objectFit: 'cover', borderRadius: '6px' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={selectedFile.name}>
                    {selectedFile.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready to upload
                  </div>
                </div>
              </div>
            )}
          </form>

          {clips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Film size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No media uploaded yet.</p>
            </div>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {clips.map((clip) => {
                const isCloudinary = clip.storageProvider === 'cloudinary';
                return (
                  <div
                    key={clip.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'var(--surface)',
                      border: '0.5px solid var(--border)',
                      transition: 'background-color 150ms ease',
                    }}
                  >
                    <div
                      style={{ overflow: 'hidden', marginRight: '8px', cursor: 'pointer', flex: 1, minWidth: 0 }}
                      onClick={() => setSelectedMediaPreview(clip)}
                      title="Click to preview file"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={clip.name}>
                          {clip.name}
                        </span>
                        {isCloudinary && (
                          <span className="neutral-badge" style={{ flexShrink: 0 }}>
                            <Cloud size={10} /> Cloudinary CDN
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Eye size={12} /> Click to preview • {clip.mimeType}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        className="btn-ghost"
                        onClick={() => setSelectedMediaPreview(clip)}
                        title="Preview media"
                        style={{ padding: '6px' }}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        className="btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClip(clip.id);
                        }}
                        style={{ padding: '6px' }}
                        title="Delete clip"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}

            </div>
          )}
        </div>
      </div>

      {/* ─── 📸 Room Memories & Snapshots Block ─── */}
      <div className="glass-card section-box" style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            <Camera size={20} color="var(--text-muted)" /> Room memories & call snapshots
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{memories.length} saved</span>
        </div>

        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Snapshots and memory pictures captured during video meetings are preserved here.
        </p>

        {loadingMemories ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading your saved memories...</p>
        ) : memories.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px', background: 'var(--surface)', borderRadius: '12px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <Camera size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            No memories saved yet. When you take a snapshot in a call, click <strong>"Save to Memories"</strong> to preserve the moment here.
          </div>
        ) : (
          <div className="memories-grid">
            {memories.map((mem) => (
              <div key={mem.id} className="memory-card">
                <img
                  src={mem.mediaUrl}
                  alt={mem.caption}
                  className="memory-img"
                  onClick={() => setSelectedMemoryView(mem)}
                  style={{ cursor: 'pointer' }}
                />
                <div className="memory-footer">
                  <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mem.caption || mem.roomName}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {new Date(mem.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <a
                      href={mem.mediaUrl}
                      download={`omnicall-memory-${mem.id}.png`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-ghost"
                      style={{ padding: '6px' }}
                      title="Download image"
                    >
                      <Download size={14} />
                    </a>
                    <button
                      onClick={() => handleDeleteMemory(mem.id)}
                      className="btn-delete"
                      style={{ padding: '6px' }}
                      title="Delete memory"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 🛡️ System Health & Metrics (Admin Only) ─── */}
      {isAdmin && (
        <div className="glass-card section-box" style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
              <Activity size={20} color="var(--accent)" /> System health & metrics
            </div>
            <span className="neutral-badge" style={{ fontSize: '0.75rem' }}>Admin visibility only</span>
          </div>

          {!healthMetrics ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading system metrics...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '14px 16px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Uptime</div>
                  <div style={{ fontSize: '1.4rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '4px' }}>{Math.floor(healthMetrics.uptime / 60)} mins</div>
                </div>

                <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '14px 16px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total requests</div>
                  <div style={{ fontSize: '1.4rem', color: 'var(--text-primary)', fontWeight: 600, marginTop: '4px' }}>{healthMetrics.metrics?.totalRequests || 0}</div>
                </div>

                <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '14px 16px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status codes</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500, marginTop: '8px' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>2xx: {healthMetrics.metrics?.statusBuckets['2xx'] || 0}</span>
                    <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }}>4xx: {healthMetrics.metrics?.statusBuckets['4xx'] || 0}</span>
                    <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>5xx: {healthMetrics.metrics?.statusBuckets['5xx'] || 0}</span>
                  </div>
                </div>

                {healthMetrics.dbPool && (
                  <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '14px 16px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Postgres pool</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500, marginTop: '8px' }}>
                      Total: {healthMetrics.dbPool.totalCount} | Idle: {healthMetrics.dbPool.idleCount} | Wait: {healthMetrics.dbPool.waitingCount}
                    </div>
                  </div>
                )}
              </div>
              
              {healthMetrics.metrics?.recentErrors?.length > 0 && (
                <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--danger)', fontWeight: 600, marginBottom: '8px' }}>Recent Errors (Last 50)</div>
                  <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '0.75rem', color: 'var(--danger)' }}>
                    {healthMetrics.metrics.recentErrors.map((err, i) => (
                      <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(220, 38, 38, 0.1)' }}>
                        <span style={{ opacity: 0.8 }}>{new Date(err.timestamp).toLocaleTimeString()}</span> - 
                        <strong> {err.method} {err.url} </strong> 
                        (Status: {err.statusCode}) {err.userId ? `User: ${err.userId}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* User Profile Edit Modal */}
      {showProfileModal && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '400px', padding: '24px', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                <Edit3 size={18} color="var(--accent)" /> Account profile
              </div>
              <button onClick={() => setShowProfileModal(false)} className="btn-ghost" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            {/* Prominent Round Profile Avatar */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px' }}>
              <div className="avatar-circle" style={{ width: '56px', height: '56px', fontSize: '1.25rem', fontWeight: 600, border: '2px solid var(--border-strong)', marginBottom: '8px' }}>
                {(editName || user?.name || user?.username || 'U').slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>@{user?.username}</span>
            </div>

            <form onSubmit={handleSaveProfile}>
              {profileModalError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px', color: '#fca5a5', fontSize: '0.8125rem', marginBottom: '14px' }}>
                  {profileModalError}
                </div>
              )}
              {profileModalSuccess && (
                <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '8px', color: '#6ee7b7', fontSize: '0.8125rem', marginBottom: '14px' }}>
                  {profileModalSuccess}
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Full Display Name</label>

                <input
                  className="form-control"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={50}
                  required
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Unique Username (@)</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#a5b4fc', fontWeight: 600 }}>@</span>
                  <input
                    className="form-control"
                    style={{ paddingLeft: '28px' }}
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    maxLength={30}
                    required
                  />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Unique handle used by others to invite you to calls.</span>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn-outline" onClick={() => setShowProfileModal(false)} style={{ flex: 1, borderRadius: '8px' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingProfile} style={{ flex: 1, borderRadius: '8px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin User Directory Modal */}
      {showAdminDirectory && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '600px', maxWidth: '94vw', padding: '24px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.125rem', color: '#f472b6' }}>
                <Shield size={20} /> Registered Accounts Directory ({adminUsersList.length})
              </div>
              <button onClick={() => setShowAdminDirectory(false)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                className="form-control"
                placeholder="Search registered accounts by name, username, or email..."
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                style={{ paddingLeft: '34px', fontSize: '0.85rem' }}
              />
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            {loadingAdminUsers ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Loading accounts database...</p>
            ) : (
              <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px' }}>Name</th>
                      <th style={{ padding: '8px' }}>Username / email</th>
                      <th style={{ padding: '8px' }}>Role</th>
                      {isAdmin && <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsersList
                      .filter((u) => {
                        const s = adminSearch.toLowerCase();
                        return (
                          !s ||
                          u.name?.toLowerCase().includes(s) ||
                          u.username?.toLowerCase().includes(s) ||
                          u.email?.toLowerCase().includes(s)
                        );
                      })
                      .map((u) => (
                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px', fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</td>
                          <td style={{ padding: '8px', color: 'var(--accent)' }}>{u.username ? `@${u.username}` : u.email}</td>
                          <td style={{ padding: '8px' }}>
                            <span className="neutral-badge" style={{ fontSize: '0.7rem', padding: '2px 6px', textTransform: 'capitalize' }}>
                              {u.role}
                            </span>
                          </td>
                          {isAdmin && (
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {u.role !== 'admin' && (
                                <button
                                  className="btn-outline"
                                  onClick={() => handleAdminDeleteUser(u)}
                                  title={`Delete user @${u.username}`}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    color: '#ef4444',
                                    borderColor: 'rgba(239, 68, 68, 0.4)',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <Trash2 size={12} /> Delete
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>

              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Memory Viewer Modal */}
      {selectedMemoryView && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }} onClick={() => setSelectedMemoryView(null)}>
          <div className="glass-card modal-box" style={{ maxWidth: '850px', width: '92vw', padding: '16px', borderRadius: '16px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{selectedMemoryView.caption || selectedMemoryView.roomName}</div>
              <button onClick={() => setSelectedMemoryView(null)} className="btn-ghost" style={{ padding: '4px' }}>
                <X size={18} />
              </button>
            </div>
            <img
              src={selectedMemoryView.mediaUrl}
              alt="Memory Fullscreen"
              style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '10px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <a
                href={selectedMemoryView.mediaUrl}
                download={`omnicall-memory-${selectedMemoryView.id}.png`}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
                style={{ width: 'auto', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
              >
                <Download size={15} /> Download high-res PNG
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Media Preview Lightbox Modal */}
      {selectedMediaPreview && (

        <div className="modal-backdrop" style={{ zIndex: 1200 }} onClick={() => setSelectedMediaPreview(null)}>
          <div className="glass-card modal-box" style={{ maxWidth: '850px', width: '92vw', padding: '20px', borderRadius: '16px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Film size={18} color="var(--accent)" /> {selectedMediaPreview.name}
              </div>
              <button onClick={() => setSelectedMediaPreview(null)} className="btn-ghost" style={{ padding: '4px' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: '#050811', borderRadius: '10px', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', maxHeight: '65vh', padding: '8px' }}>
              {selectedMediaPreview.mimeType?.startsWith('image/') ? (
                <img
                  src={selectedMediaPreview.publicUrl || api.getStreamUrl(token, selectedMediaPreview.id)}
                  alt={selectedMediaPreview.name}
                  style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px' }}
                />
              ) : selectedMediaPreview.mimeType?.startsWith('video/') ? (
                <video
                  src={selectedMediaPreview.publicUrl || api.getStreamUrl(token, selectedMediaPreview.id)}
                  controls
                  autoPlay
                  style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px' }}
                />
              ) : (
                <audio
                  src={selectedMediaPreview.publicUrl || api.getStreamUrl(token, selectedMediaPreview.id)}
                  controls
                  autoPlay
                  style={{ width: '100%', padding: '20px' }}
                />
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {selectedMediaPreview.mimeType} • {selectedMediaPreview.storageProvider?.toUpperCase()}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={selectedMediaPreview.publicUrl || api.getStreamUrl(token, selectedMediaPreview.id)}
                  download={selectedMediaPreview.name}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary"
                  style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Download File
                </a>
                <button
                  className="btn-outline"
                  onClick={() => {
                    handleDeleteClip(selectedMediaPreview.id);
                    setSelectedMediaPreview(null);
                  }}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Custom Delete Room Modal */}
      {deletingRoomTarget && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '380px', padding: '24px', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.125rem', color: '#ef4444', marginBottom: '12px' }}>
              <AlertTriangle size={22} /> Confirm Room Deletion
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Are you sure you want to permanently delete room <strong>"{deletingRoomTarget.name}"</strong>? All members and in-call chat data will be removed.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-outline"
                onClick={() => setDeletingRoomTarget(null)}
                style={{ flex: 1, borderRadius: '8px' }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={confirmDeleteRoom}
                disabled={deleting}
                style={{ flex: 1, background: 'linear-gradient(135deg, #ef4444, #dc2626)', borderRadius: '8px' }}
              >
                {deleting ? 'Deleting...' : 'Delete Room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Leave Room Modal */}
      {leavingRoomTarget && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '380px', padding: '24px', borderRadius: '16px', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.125rem', color: '#f59e0b', marginBottom: '12px' }}>
              <LogOut size={22} /> Confirm Leaving Room
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Are you sure you want to leave room <strong>"{leavingRoomTarget.name}"</strong>? It will be removed from your active room list.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-outline"
                onClick={() => setLeavingRoomTarget(null)}
                style={{ flex: 1, borderRadius: '8px' }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={confirmLeaveRoom}
                disabled={leaving}
                style={{ flex: 1, background: 'linear-gradient(135deg, #f59e0b, #d97706)', borderRadius: '8px' }}
              >
                {leaving ? 'Leaving...' : 'Leave Room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Call Nickname Modal */}
      {joiningRoom && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '360px', padding: '24px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Join {joiningRoom.name}</span>
              <button onClick={() => setJoiningRoom(null)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={confirmJoin}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Display Name in Call</label>
                <input
                  className="form-control"
                  value={customNickname}
                  onChange={(e) => setCustomNickname(e.target.value)}
                  maxLength={50}
                  required
                  style={{ borderRadius: '8px' }}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-primary" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', borderRadius: '8px' }}>
                Confirm & Join Call
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

