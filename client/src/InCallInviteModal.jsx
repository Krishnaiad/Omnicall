import { useState } from 'react';
import { UserPlus, Search, X, Check, Loader2 } from 'lucide-react';
import { api } from './api.js';

export default function InCallInviteModal({ token, roomId, roomName, onClose }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState(new Set());
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const data = await api.searchUsers(token, query.trim());
      setSearchResults(data.users || []);
      if (data.users.length === 0) {
        setError(`No users found matching "${query.trim()}".`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleSendInvite = async (userObj) => {
    try {
      await api.inviteToRoom(token, roomId, userObj.username || userObj.email);
      setInvitedUsers((prev) => new Set(prev).add(userObj.id));
    } catch (err) {
      alert(`Could not invite ${userObj.name || userObj.username}: ${err.message}`);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="glass-card modal-box" style={{ width: '420px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '1.125rem' }}>
            <UserPlus size={20} color="#818cf8" /> Invite People to {roomName}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              className="form-control"
              placeholder="Search by username or email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: '34px' }}
              autoFocus
            />
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>
          <button type="submit" className="btn-primary" disabled={searching} style={{ padding: '0 16px' }}>
            {searching ? <Loader2 size={16} className="spin" /> : 'Search'}
          </button>
        </form>

        {error && (
          <div style={{ fontSize: '0.875rem', color: '#f87171', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {searchResults.map((userObj) => {
            const isInvited = invitedUsers.has(userObj.id);
            return (
              <div
                key={userObj.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#fff' }}>
                    {userObj.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>({userObj.username ? `@${userObj.username}` : userObj.email})</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{userObj.email}</div>
                </div>

                {isInvited ? (
                  <span style={{ fontSize: '0.75rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    <Check size={14} /> Invited
                  </span>
                ) : (
                  <button
                    className="btn-primary"
                    style={{ padding: '4px 12px', fontSize: '0.75rem', background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
                    onClick={() => handleSendInvite(userObj)}
                  >
                    Invite
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
