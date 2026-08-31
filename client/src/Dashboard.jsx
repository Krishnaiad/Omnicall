import { useEffect, useState, useRef } from 'react';
import { api } from './api.js';
import { LogOut, Plus, UserPlus, Video, Film, Upload, Trash2, Users, Shield, Bell, Activity, Radio, AlertTriangle, X, UserCheck, Edit3, Cloud, HardDrive } from 'lucide-react';

export default function Dashboard({ token, user, onLogout, onJoinCall, onUserUpdate }) {
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

  // Profile Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState(user.name || '');
  const [editUsername, setEditUsername] = useState(user.username || '');
  const [savingProfile, setSavingProfile] = useState(false);

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

    // Native Browser Server-Sent Events (SSE) notification stream for instant live invites
    const sseUrl = `${api.BASE_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(sseUrl);
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

    const interval = setInterval(() => {
      fetchRooms();
    }, 15000);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, [token, user.id]);

  // Auto-clear error and success messages after 5 seconds
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

      setSuccess('Profile updated successfully!');
      if (onUserUpdate) onUserUpdate(data.user, data.token, data.refreshToken);
      setShowProfileModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingProfile(false);
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
      setSuccess('Room created successfully!');
      fetchRooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDeleteRoom = async () => {
    if (!deletingRoomTarget) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      await api.deleteRoom(token, deletingRoomTarget.id);
      setSuccess(`Room "${deletingRoomTarget.name}" deleted successfully.`);
      setRooms((prev) => prev.filter((r) => r.id !== deletingRoomTarget.id));
      setDeletingRoomTarget(null);
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
    setSuccess('');
    try {
      await api.leaveRoom(token, leavingRoomTarget.id);
      setSuccess(`Left room "${leavingRoomTarget.name}".`);
      setRooms((prev) => prev.filter((r) => r.id !== leavingRoomTarget.id));
      setLeavingRoomTarget(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLeaving(false);
    }
  };

  const handleInvite = async (roomId) => {
    const term = (inviteEmail[roomId] || '').trim();
    if (!term) return;
    setError('');
    setSuccess('');
    try {
      await api.inviteToRoom(token, roomId, term);
      setInviteEmail((prev) => ({ ...prev, [roomId]: '' }));
      setSuccess(`Invited ${term} to room successfully!`);
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

  return (
    <div className="dashboard-layout" style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px' }}>
      {/* Top Navbar */}
      <nav className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', marginBottom: '28px', border: '1px solid rgba(129, 140, 248, 0.25)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', borderRadius: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)' }}>
            <Video size={24} color="#fff" />
          </div>
          <div>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, background: 'linear-gradient(135deg, #fff, #a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>
              OmniCall Workspace
            </span>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <Radio size={12} color="#10b981" /> Real-Time WebRTC Suite
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {isAdmin && (
            <button
              className="btn-outline"
              onClick={handleOpenAdminDirectory}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(236, 72, 153, 0.5)', color: '#f472b6', background: 'rgba(236, 72, 153, 0.1)', padding: '8px 14px', borderRadius: '10px', fontSize: '0.8125rem', fontWeight: 600 }}
            >
              <Users size={16} /> User Directory
            </button>
          )}

          <button
            className="btn-outline"
            onClick={() => setShowProfileModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px', fontSize: '0.8125rem', borderColor: 'rgba(99, 102, 241, 0.4)', color: '#a5b4fc' }}
          >
            <UserCheck size={16} /> Profile (@{user.username || 'user'})
          </button>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}>{user.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.email}</div>
          </div>

          <button className="btn-outline" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px', fontSize: '0.8125rem' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      {/* Quick Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        <div className="glass-card" style={{ padding: '20px', borderRadius: '14px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>ACTIVE ROOMS</span>
            <Video size={18} color="#818cf8" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{rooms.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#a5b4fc', marginTop: '4px' }}>Ready for Instant Video Calls</div>
        </div>

        <div className="glass-card" style={{ padding: '20px', borderRadius: '14px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>MEDIA CLIPS</span>
            <Film size={18} color="#ec4899" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{clips.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#f472b6', marginTop: '4px' }}>Uploaded & Streamable</div>
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

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px' }}>
        {/* Video Rooms Box */}
        <div className="glass-card" style={{ padding: '24px', borderRadius: '16px', border: '1px solid rgba(129, 140, 248, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
              <Video size={20} color="#818cf8" /> Your Video Rooms
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unique Room Names Enforced</span>
          </div>

          <form onSubmit={handleCreateRoom} style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
            <input
              className="form-control"
              placeholder="Create new unique room name..."
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              maxLength={80}
              style={{ borderRadius: '10px' }}
            />
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 20px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
              <Plus size={18} /> Create Room
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
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
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
        <div className="glass-card" style={{ padding: '24px', borderRadius: '16px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
              <Film size={20} color="#ec4899" /> Media Library Injector
            </div>
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Upload Images (PNG, JPG), Videos (MP4), or Audio (MP3). Stream them directly into your call tile or broadcast to the shared Presentation Stage!
          </p>

          <form onSubmit={handleUploadClip} style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp3,audio/wav"
              className="form-control"
              style={{ fontSize: '0.8125rem', padding: '6px', borderRadius: '10px' }}
              onChange={(e) => setSelectedFile(e.target.files[0])}
            />
            <button type="submit" className="btn-primary" disabled={!selectedFile || uploading} style={{ width: 'auto', padding: '0 20px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #ec4899, #818cf8)' }}>
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload File'}
            </button>
          </form>

          {clips.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No media uploaded yet.</p>
          ) : (
            <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {clips.map((clip) => {
                const isCloudinary = clip.storageProvider === 'cloudinary';
                const isR2 = clip.storageProvider === 'r2';
                return (
                  <div key={clip.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {clip.name}
                        {isCloudinary ? (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Cloud size={10} /> Cloudinary CDN
                          </span>
                        ) : isR2 ? (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Cloud size={10} /> Cloudflare R2
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(156, 163, 175, 0.2)', color: '#d1d5db', border: '1px solid rgba(156, 163, 175, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <HardDrive size={10} /> Local Storage
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{clip.mimeType} • {clip.status}</div>
                    </div>

                    <button
                      className="btn-outline"
                      onClick={() => handleDeleteClip(clip.id)}
                      style={{ padding: '6px 10px', borderRadius: '8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
          <div className="glass-card modal-box" style={{ width: '560px', padding: '24px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.125rem', color: '#f472b6' }}>
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
                      <th style={{ padding: '10px' }}>Name</th>
                      <th style={{ padding: '10px' }}>Username / Email</th>
                      <th style={{ padding: '10px' }}>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsersList.map((u) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '10px', fontWeight: 600, color: '#fff' }}>{u.name}</td>
                        <td style={{ padding: '10px', color: '#a5b4fc' }}>{u.username ? `@${u.username}` : u.email}</td>
                        <td style={{ padding: '10px' }}>
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
