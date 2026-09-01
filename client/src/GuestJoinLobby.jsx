import { useState, useEffect } from 'react';
import { Video, UserCheck, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from './api.js';

export default function GuestJoinLobby({ inviteToken, onGuestJoinSuccess, onGoToLogin }) {
  const [preview, setPreview] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadPreview = async () => {
      try {
        const data = await api.getJoinPreview(inviteToken);
        setPreview(data);
      } catch (err) {
        setError(err.message || 'Invalid or expired invite link.');
      } finally {
        setLoading(false);
      }
    };
    loadPreview();
  }, [inviteToken]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setError('Please enter a display name to enter the call.');
      return;
    }

    setJoining(true);
    setError('');

    try {
      const data = await api.guestJoin(inviteToken, guestName.trim());
      onGuestJoinSuccess({
        room: { id: data.roomId, name: data.roomName, owner_id: preview?.hostName },
        appToken: data.token,
        roomToken: data.roomToken,
        displayName: data.displayName,
        guestUser: data.guestUser,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="glass-card auth-box">
        <div className="auth-header">
          <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '12px', marginBottom: '12px' }}>
            <Video size={32} color="#818cf8" />
          </div>
          <h1>Join OmniCall Meeting</h1>
          {loading ? (
            <p>Inspecting meeting invite…</p>
          ) : preview ? (
            <p>You were invited by <strong style={{ color: '#a5b4fc' }}>{preview.hostName}</strong> to join <strong style={{ color: '#ec4899' }}>"{preview.roomName}"</strong></p>
          ) : (
            <p style={{ color: '#f87171' }}>{error}</p>
          )}
        </div>

        {preview && (
          <form onSubmit={handleJoin}>
            {error && (
              <div style={{ fontSize: '0.8rem', color: '#f87171', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Your Display Name:
              </label>
              <input
                className="form-control"
                placeholder="e.g. Alex Kumar"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={joining}
              style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.95rem' }}
            >
              <UserCheck size={18} /> {joining ? 'Connecting to Call…' : 'Join as Guest'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Already have an account?{' '}
              <button
                type="button"
                onClick={onGoToLogin}
                style={{ background: 'transparent', color: '#818cf8', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Sign In
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
