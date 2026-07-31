import { useEffect, useState } from 'react';
import { api } from './api.js';
import { LogOut, Plus, UserPlus, Video, Film, Upload, Trash2, CheckCircle2, Clock, UserCheck, X } from 'lucide-react';

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

  // Join Call Nickname Modal State
  const [joiningRoom, setJoiningRoom] = useState(null);
  const [customNickname, setCustomNickname] = useState('');

  const fetchRooms = async () => {
    try {
      const data = await api.listRooms(token);
      setRooms(data.rooms || []);
    } catch (err) {
      setError(err.message);
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

  useEffect(() => {
    fetchRooms();
    fetchClips();
  }, [token]);

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
      setSuccess('Media clip uploaded and queued for processing!');
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
    <div className="dashboard-layout">
      <nav className="glass-card dashboard-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Video size={28} color="#818cf8" />
          <span className="brand-title">OmniCall Workspace</span>
        </div>
        <div className="user-badge">
          <span className="user-info">Signed in as <strong>{user.name}</strong></span>
          <button className="btn-outline" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

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
              placeholder="New room name (e.g. Design Sync)"
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
                    <button
                      className="btn-primary"
                      style={{ width: 'auto', padding: '6px 14px', fontSize: '0.875rem' }}
                      onClick={() => promptJoin(room)}
                    >
                      Join Call
                    </button>
                  </div>

                  {room.role === 'owner' && (
                    <div className="invite-row">
                      <input
                        className="form-control"
                        placeholder="Invite member by email"
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

        {/* Media Library Section */}
        <div className="glass-card section-box">
          <div className="section-title">
            <Film size={20} color="#ec4899" />
            <span>Server Media Library</span>
          </div>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Pre-upload video/audio clips here to stream securely during calls. Clips are validated & transcoded on the server.
          </p>

          <form onSubmit={handleUploadClip} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <input
              type="file"
              accept="video/mp4,video/webm,audio/mp3,audio/wav"
              className="form-control"
              style={{ fontSize: '0.8125rem', padding: '6px' }}
              onChange={(e) => setSelectedFile(e.target.files[0])}
            />
            <button type="submit" className="btn-primary" disabled={!selectedFile || uploading} style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </form>

          {clips.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No clips uploaded yet.</p>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {clips.map((clip) => (
                <div key={clip.id} className="room-item" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {clip.status === 'ready' ? <CheckCircle2 size={18} color="#10b981" /> : <Clock size={18} color="#f59e0b" />}
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{clip.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{clip.mimeType} • {clip.status}</div>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteClip(clip.id)} style={{ background: 'transparent', color: '#ef4444', border: 'none' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Join Room Nickname Choice Modal */}
      {joiningRoom && (
        <div className="modal-backdrop">
          <div className="glass-card modal-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontWeight: 600, fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={20} color="#818cf8" /> Choose In-Room Nickname
              </div>
              <button onClick={() => setJoiningRoom(null)} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Joining <strong>{joiningRoom.name}</strong>. Enter the nickname you want other participants to see in this call:
            </p>

            <form onSubmit={confirmJoin}>
              <div className="form-group">
                <label>In-Room Display Name</label>
                <input
                  className="form-control"
                  value={customNickname}
                  onChange={(e) => setCustomNickname(e.target.value)}
                  maxLength={50}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button type="button" className="btn-outline" onClick={() => setJoiningRoom(null)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  Enter Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
