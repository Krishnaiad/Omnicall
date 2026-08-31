import { useEffect, useState, useRef } from 'react';
import { api } from './api.js';
import { LogOut, Plus, UserPlus, Video, Film, Upload, Trash2, Users, Shield, Bell, Activity, Radio, AlertTriangle, X, UserCheck, Edit3, Cloud, HardDrive, Image as ImageIcon, Download, Search, CheckCircle2, Sparkles, Camera } from 'lucide-react';

export default function Dashboard({ token, user, onLogout, onJoinCall, onUserUpdate }) {
  const [rooms, setRooms] = useState([]);
  const [clips, setClips] = useState([]);
  const [memories, setMemories] = useState([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [inviteEmail, setInviteEmail] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMemories, setLoadingMemories] = useState(true);
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
  const [editName, setEditName] = useState(user.name || '');
  const [editUsername, setEditUsername] = useState(user.username || '');
  const [savingProfile, setSavingProfile] = useState(false);

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


  useEffect(() => {
    fetchRooms();
    fetchClips();
    fetchMemories();

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
    }, 15000);

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

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!editName.trim() || !editUsername.trim()) return;
    setSavingProfile(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${api.BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: editName.trim(), username: editUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');

      setSuccess(`✅ Profile updated to @${data.user.username} successfully!`);
      if (onUserUpdate) onUserUpdate(data.user, data.token, data.refreshToken);
      setShowProfileModal(false);
    } catch (err) {
      setError(err.message);
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
      await api.inviteUser(token, roomId, identifier);
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


  const confirmJoin = (e) => {
    e.preventDefault();
    if (!joiningRoom) return;
    onJoinCall(joiningRoom, customNickname.trim() || user.name);
    setJoiningRoom(null);
  };


  return (

    <div className="dashboard-layout">
      {/* Top Responsive Navbar */}
      <nav className="dashboard-nav glass-card" style={{ border: '1px solid rgba(129, 140, 248, 0.25)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div className="brand-header-box" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)' }}>
            <Video size={22} color="#fff" />
          </div>
          <div>
            <div className="brand-title">OmniCall Workspace</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <Radio size={12} color="#10b981" /> Real-Time WebRTC Platform
            </div>
          </div>
        </div>

        <div className="user-badge">
          <button
            className="btn-outline"
            onClick={handleOpenAdminDirectory}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(236, 72, 153, 0.5)', color: '#f472b6', background: 'rgba(236, 72, 153, 0.1)', fontWeight: 600 }}
          >
            <Users size={15} /> User Directory
          </button>


          <button
            className="btn-outline"
            onClick={() => setShowProfileModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(99, 102, 241, 0.4)', color: '#a5b4fc' }}
          >
            <UserCheck size={15} /> Profile (@{user.username || 'user'})
          </button>

          <button className="btn-outline" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
            <LogOut size={15} /> Logout
          </button>
        </div>
      </nav>

      {/* Quick Stat Cards */}
      <div className="dash-stats">
        <div className="glass-card" style={{ padding: '18px', borderRadius: '14px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px' }}>ACTIVE ROOMS</span>
            <Video size={18} color="#818cf8" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{rooms.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#a5b4fc', marginTop: '4px' }}>Ready for Instant Video Calls</div>
        </div>

        <div className="glass-card" style={{ padding: '18px', borderRadius: '14px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px' }}>MEDIA CLIPS</span>
            <Film size={18} color="#ec4899" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{clips.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#f472b6', marginTop: '4px' }}>Cloudinary CDN Streamable</div>
        </div>

        <div className="glass-card" style={{ padding: '18px', borderRadius: '14px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px' }}>ROOM MEMORIES</span>
            <Camera size={18} color="#10b981" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{memories.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#6ee7b7', marginTop: '4px' }}>Saved Call Snapshots</div>
        </div>
      </div>

      {/* Notifications */}
      {inviteNotice && (
        <div className="error-banner" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(236, 72, 153, 0.9))', color: '#fff', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '12px' }}>
          <Bell size={18} /> {inviteNotice}
        </div>
      )}

      {error && <div className="error-banner" style={{ marginBottom: '20px', borderRadius: '12px' }}>{error}</div>}
      {success && <div className="error-banner" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#6ee7b7', marginBottom: '20px', borderRadius: '12px' }}>{success}</div>}

      {/* Main Grid: Video Rooms + Media Injector */}
      <div className="dash-sections">
        {/* Video Rooms Box */}
        <div className="glass-card section-box" style={{ border: '1px solid rgba(129, 140, 248, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
              <Video size={20} color="#818cf8" /> Your Video Rooms
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unique Names Enforced</span>
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
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 20px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
              <Plus size={18} /> Create
            </button>
          </form>

          {loadingRooms ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading rooms...</p>
          ) : rooms.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No rooms joined yet. Create one above to get started!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rooms.map((room) => (
                <div
                  key={room.id}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginRight: '8px' }}>{room.name}</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700, textTransform: 'uppercase', background: room.role === 'owner' ? 'rgba(236,72,153,0.2)' : 'rgba(99,102,241,0.2)', color: room.role === 'owner' ? '#f472b6' : '#a5b4fc', border: room.role === 'owner' ? '1px solid rgba(236,72,153,0.4)' : '1px solid rgba(99,102,241,0.4)' }}>
                        {room.role}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn-primary"
                        style={{ width: 'auto', padding: '6px 14px', borderRadius: '8px', fontSize: '0.8125rem', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => promptJoin(room)}
                      >
                        <Video size={14} /> Join Call
                      </button>

                      {room.role === 'owner' ? (
                        <button
                          className="btn-outline"
                          onClick={() => setDeletingRoomTarget(room)}
                          title="Delete Room permanently (Owner Only)"
                          style={{ padding: '6px 10px', borderRadius: '8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239,68,68,0.1)' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <button
                          className="btn-outline"
                          onClick={() => setLeavingRoomTarget(room)}
                          title="Leave Room"
                          style={{ padding: '6px 10px', borderRadius: '8px', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245,158,11,0.1)' }}
                        >
                          <LogOut size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {room.role === 'owner' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        className="form-control"
                        placeholder="Invite user by username or email..."
                        style={{ fontSize: '0.8125rem', padding: '6px 12px', borderRadius: '8px' }}
                        value={inviteEmail[room.id] || ''}
                        onChange={(e) => setInviteEmail((prev) => ({ ...prev, [room.id]: e.target.value }))}
                      />
                      <button
                        className="btn-outline"
                        style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
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
        <div className="glass-card section-box" style={{ border: '1px solid rgba(236, 72, 153, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
              <Film size={20} color="#ec4899" /> Media Library Injector
            </div>
            {clips.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAllClips}
                style={{ background: 'transparent', color: '#f87171', border: 'none', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Trash2 size={12} /> Clear All
              </button>
            )}
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Upload Images (PNG, JPG), Videos (MP4), or Audio (MP3) up to 100MB to stream directly into your call tile!
          </p>

          <form onSubmit={handleUploadClip} style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp3,audio/wav"
                className="form-control"
                style={{ fontSize: '0.8125rem', padding: '6px', borderRadius: '10px', flex: 1 }}
                onChange={handleFileSelect}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={!selectedFile || uploading}
                style={{ width: 'auto', padding: '8px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #ec4899, #818cf8)' }}
              >
                <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            {/* Instant Upload Preview Card */}
            {previewUrl && selectedFile && (
              <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(0,0,0,0.4)', borderRadius: '10px', border: '1px solid rgba(236, 72, 153, 0.3)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {selectedFile.type.startsWith('image/') ? (
                  <img src={previewUrl} alt="Preview" style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} />
                ) : (
                  <video src={previewUrl} style={{ width: '60px', height: '45px', objectFit: 'cover', borderRadius: '6px' }} />
                )}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {selectedFile.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#ec4899' }}>
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready to upload
                  </div>
                </div>
              </div>
            )}
          </form>

          {clips.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No media uploaded yet.</p>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {clips.map((clip) => {
                const isCloudinary = clip.storageProvider === 'cloudinary';
                return (
                  <div key={clip.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {clip.name}
                        {isCloudinary && (
                          <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Cloud size={9} /> Cloudinary CDN
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{clip.mimeType} • {clip.status}</div>
                    </div>

                    <button
                      className="btn-outline"
                      onClick={() => handleDeleteClip(clip.id)}
                      style={{ padding: '4px 8px', borderRadius: '6px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── 📸 Room Memories & Snapshots Block ─── */}
      <div className="glass-card section-box" style={{ border: '1px solid rgba(16, 185, 129, 0.25)', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
            <Camera size={20} color="#10b981" /> 📸 Room Memories & Call Snapshots
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{memories.length} Moments Saved</span>
        </div>

        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Snapshots and memory pictures captured during video meetings are saved here in full high-resolution for your account.
        </p>

        {loadingMemories ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading your saved memories...</p>
        ) : memories.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No memories saved yet! When you take a snapshot in a call, click <strong>"Save to Memories"</strong> to preserve the moment here.
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
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      className="btn-outline"
                      style={{ padding: '4px 6px', borderRadius: '6px', color: '#818cf8', display: 'flex', alignItems: 'center' }}
                      title="Download Image"
                    >
                      <Download size={13} />
                    </a>
                    <button
                      onClick={() => handleDeleteMemory(mem.id)}
                      className="btn-outline"
                      style={{ padding: '4px 6px', borderRadius: '6px', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center' }}
                      title="Delete Memory"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Profile Edit Modal */}
      {showProfileModal && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card modal-box" style={{ width: '400px', padding: '24px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.125rem', color: '#a5b4fc' }}>
                <Edit3 size={20} /> Update Account Profile
              </div>
              <button onClick={() => setShowProfileModal(false)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile}>
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
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px' }}>Name</th>
                      <th style={{ padding: '8px' }}>Username / Email</th>
                      <th style={{ padding: '8px' }}>Role</th>
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
                        <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ padding: '8px', fontWeight: 600, color: '#fff' }}>{u.name}</td>
                          <td style={{ padding: '8px', color: '#a5b4fc' }}>{u.username ? `@${u.username}` : u.email}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ fontSize: '0.7rem', background: u.role === 'admin' ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.1)', color: u.role === 'admin' ? '#f472b6' : 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
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

      {/* Fullscreen Memory Viewer Modal */}
      {selectedMemoryView && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }} onClick={() => setSelectedMemoryView(null)}>
          <div className="glass-card modal-box" style={{ maxWidth: '850px', width: '92vw', padding: '16px', borderRadius: '16px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>{selectedMemoryView.caption || selectedMemoryView.roomName}</div>
              <button onClick={() => setSelectedMemoryView(null)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={20} />
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
                <Download size={15} /> Download High-Res PNG
              </a>
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

