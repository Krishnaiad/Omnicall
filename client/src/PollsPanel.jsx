import { useEffect, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { BarChart3, Plus, X, Check, Lock, AlertCircle } from 'lucide-react';
import { api } from './api.js';

export default function PollsPanel({ token, room, roomId, user, isHost, onClose }) {
  const [polls, setPolls] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 1. Fetch polls on open (Late-Joiner State Recovery)
  useEffect(() => {
    let mounted = true;
    const loadPolls = async () => {
      try {
        const data = await api.getPolls(token, roomId);
        if (mounted && data.polls) {
          setPolls(data.polls);
        }
      } catch (err) {
        console.warn('Failed to load polls:', err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadPolls();

    // 2. Real-time updates via LiveKit Reliable DataChannel
    if (!room) return;

    const handleDataReceived = (payload, _participant, _kind, topic) => {
      if (topic !== 'room-state:polls') return;
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));

        if (data.type === 'POLL_CREATED') {
          setPolls((prev) => [data.poll, ...prev.filter((p) => p.id !== data.poll.id)]);
        } else if (data.type === 'POLL_VOTED') {
          setPolls((prev) =>
            prev.map((p) =>
              p.id === data.pollId ? { ...p, votes: data.votes, totalVotes: data.totalVotes } : p
            )
          );
        } else if (data.type === 'POLL_CLOSED') {
          setPolls((prev) =>
            prev.map((p) => (p.id === data.pollId ? { ...p, status: 'closed' } : p))
          );
        }
      } catch (err) {
        console.warn('Polls DataPacket error:', err.message);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      mounted = false;
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [token, room, roomId]);

  const handleAddOption = () => {
    if (options.length < 6) setOptions([...options, '']);
  };

  const handleOptionChange = (index, value) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  };

  const handleCreatePoll = async (e) => {
    e.preventDefault();
    const cleanQuestion = question.trim();
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!cleanQuestion || cleanOptions.length < 2) {
      setError('Please provide a question and at least 2 options.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // A. Write to Express & Postgres FIRST (authoritative host check + DB insert)
      const data = await api.createPoll(token, roomId, cleanQuestion, cleanOptions);
      if (data.poll) {
        setPolls((prev) => [data.poll, ...prev]);

        // B. Broadcast over LiveKit Reliable DataChannel
        if (room?.localParticipant) {
          const encoder = new TextEncoder();
          const payload = encoder.encode(JSON.stringify({ type: 'POLL_CREATED', poll: data.poll }));
          room.localParticipant.publishData(payload, { topic: 'room-state:polls', reliable: true });
        }

        setShowCreate(false);
        setQuestion('');
        setOptions(['', '']);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (pollId, optionIndex) => {
    try {
      // 1. Submit vote to server (authoritative tallying)
      const res = await api.votePoll(token, roomId, pollId, optionIndex);

      // 2. Update local state
      setPolls((prev) =>
        prev.map((p) =>
          p.id === pollId
            ? { ...p, votes: res.votes, totalVotes: res.totalVotes, userVotedOption: optionIndex }
            : p
        )
      );

      // 3. Broadcast updated authoritative tally over LiveKit
      if (room?.localParticipant) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(
          JSON.stringify({
            type: 'POLL_VOTED',
            pollId,
            votes: res.votes,
            totalVotes: res.totalVotes,
          })
        );
        room.localParticipant.publishData(payload, { topic: 'room-state:polls', reliable: true });
      }
    } catch (err) {
      console.warn('Vote failed:', err.message);
    }
  };

  const handleClosePoll = async (pollId) => {
    try {
      await api.closePoll(token, roomId, pollId);
      setPolls((prev) => prev.map((p) => (p.id === pollId ? { ...p, status: 'closed' } : p)));

      if (room?.localParticipant) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(JSON.stringify({ type: 'POLL_CLOSED', pollId }));
        room.localParticipant.publishData(payload, { topic: 'room-state:polls', reliable: true });
      }
    } catch (err) {
      console.warn('Close poll failed:', err.message);
    }
  };

  return (
    <div className="chat-sidebar" style={{ zIndex: 1100 }}>
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
          <BarChart3 size={18} color="#818cf8" />
          <span>In-Room Polls & Q&A</span>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '12px', overflowY: 'auto', flex: 1 }}>
        {isHost && !showCreate && (
          <button
            className="btn-primary"
            onClick={() => setShowCreate(true)}
            style={{ width: '100%', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> Launch New Poll
          </button>
        )}

        {/* Create Poll Form (Host Only) */}
        {showCreate && (
          <form onSubmit={handleCreatePoll} className="glass-card" style={{ padding: '14px', marginBottom: '16px', border: '1px solid #818cf8' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '10px', color: '#a5b4fc' }}>Launch a Live Poll</div>
            {error && <div style={{ color: '#f87171', fontSize: '0.75rem', marginBottom: '8px' }}>{error}</div>}

            <input
              className="form-control"
              placeholder="Ask a question..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              style={{ marginBottom: '10px', fontSize: '0.85rem' }}
            />

            {options.map((opt, idx) => (
              <input
                key={idx}
                className="form-control"
                placeholder={`Option ${idx + 1}`}
                value={opt}
                onChange={(e) => handleOptionChange(idx, e.target.value)}
                style={{ marginBottom: '6px', fontSize: '0.8rem' }}
              />
            ))}

            {options.length < 6 && (
              <button
                type="button"
                onClick={handleAddOption}
                style={{ background: 'transparent', color: '#818cf8', fontSize: '0.75rem', padding: '4px 0', cursor: 'pointer', display: 'block', marginBottom: '12px' }}
              >
                + Add Another Option
              </button>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" disabled={submitting} className="btn-primary" style={{ flex: 1, padding: '6px 12px', fontSize: '0.8rem' }}>
                {submitting ? 'Launching…' : 'Launch Poll'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '24px', fontSize: '0.85rem' }}>Loading active polls…</div>
        ) : polls.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '24px', fontSize: '0.85rem' }}>
            No polls launched yet.
            {isHost ? ' Click "Launch New Poll" above to ask participants a question!' : ' The room creator will launch polls here.'}
          </div>
        ) : (
          polls.map((poll) => {
            const isClosed = poll.status === 'closed';
            const total = poll.totalVotes || 0;

            return (
              <div key={poll.id} className="glass-card" style={{ padding: '14px', marginBottom: '14px', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>{poll.question}</div>
                  {isClosed && (
                    <span style={{ fontSize: '0.65rem', background: 'rgba(239,68,68,0.2)', color: '#f87171', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Lock size={10} /> Closed
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {poll.options.map((opt, optIdx) => {
                    const voteCount = poll.votes?.[optIdx] || 0;
                    const percent = total > 0 ? Math.round((voteCount / total) * 100) : 0;
                    const isSelected = poll.userVotedOption === optIdx;

                    return (
                      <button
                        key={optIdx}
                        disabled={isClosed}
                        onClick={() => handleVote(poll.id, optIdx)}
                        style={{
                          position: 'relative',
                          textAlign: 'left',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          background: isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: isSelected ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.08)',
                          cursor: isClosed ? 'default' : 'pointer',
                          overflow: 'hidden',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Fill bar */}
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            bottom: 0,
                            width: `${percent}%`,
                            background: isSelected ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.08)',
                            transition: 'width 0.3s ease',
                            zIndex: 0,
                          }}
                        />
                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                          <span style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? '#a5b4fc' : '#fff' }}>
                            {opt} {isSelected && <Check size={12} style={{ display: 'inline', marginLeft: '4px' }} />}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>
                            {percent}% ({voteCount})
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>Total votes: <strong>{total}</strong></span>
                  {isHost && !isClosed && (
                    <button
                      onClick={() => handleClosePoll(poll.id)}
                      style={{ background: 'transparent', color: '#f87171', border: 'none', cursor: 'pointer', fontSize: '0.7rem' }}
                    >
                      End Poll
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
