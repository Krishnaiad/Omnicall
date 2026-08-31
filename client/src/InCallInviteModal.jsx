import { useState, useEffect } from 'react';
import { UserPlus, Search, X, Check, Loader2, Link as LinkIcon, Copy } from 'lucide-react';
import { api } from './api.js';

export default function InCallInviteModal({ token, roomId, roomName, onClose }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState(new Set());
  const [error, setError] = useState(null);
  const [shareableUrl, setShareableUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    const fetchLink = async () => {
      try {
        const data = await api.getInviteLink(token, roomId);
        if (data.inviteToken) {
          const fullUrl = `${window.location.origin}/join/${data.inviteToken}`;
          setShareableUrl(fullUrl);
        }
      } catch (err) {
        console.warn('Could not generate shareable link:', err.message);
      }
    };
    fetchLink();
  }, [token, roomId]);

  const handleCopyLink = () => {
    if (!shareableUrl) return;
    navigator.clipboard.writeText(shareableUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };


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

        {/* 1-Click Shareable Guest Invite Link */}
        {shareableUrl && (
          <div style={{ marginBottom: '16px', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a5b4fc', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <LinkIcon size={13} /> 1-Click Shareable Guest Link
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                readOnly
                value={shareableUrl}
                style={{ flex: 1, fontSize: '0.75rem', padding: '6px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="btn-primary"
                style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                {copiedLink ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Or Search Registered Users:
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
