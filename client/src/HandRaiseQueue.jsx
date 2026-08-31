import { useEffect, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { Hand, X, Check, ArrowDownCircle } from 'lucide-react';
import { api } from './api.js';

export default function HandRaiseQueue({ token, room, roomId, user, isHost, onClose, onHandRaiseCountChange }) {
  const [queue, setQueue] = useState([]);
  const [raising, setRaising] = useState(false);

  // 1. Fetch hand raise queue on open (Late-Joiner State Recovery)
  useEffect(() => {
    let mounted = true;
    const loadQueue = async () => {
      try {
        const data = await api.getHandRaises(token, roomId);
        if (mounted && data.handRaises) {
          setQueue(data.handRaises);
          if (onHandRaiseCountChange) onHandRaiseCountChange(data.handRaises.length);
        }
      } catch (err) {
        console.warn('Failed to load hand raises:', err.message);
      }
    };

    loadQueue();

    // 2. Real-time updates via LiveKit Reliable DataChannel
    if (!room) return;

    const handleDataReceived = (payload, _participant, _kind, topic) => {
      if (topic !== 'room-state:hand-raise') return;
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));

        if (data.type === 'HAND_RAISED') {
          setQueue((prev) => {
            const filtered = prev.filter((h) => h.userId !== data.handRaise.userId);
            const updated = [...filtered, data.handRaise].sort((a, b) => a.sequenceNum - b.sequenceNum);
            if (onHandRaiseCountChange) onHandRaiseCountChange(updated.length);
            return updated;
          });
        } else if (data.type === 'HAND_LOWERED') {
          setQueue((prev) => {
            const updated = prev.filter((h) => h.userId !== data.userId);
            if (onHandRaiseCountChange) onHandRaiseCountChange(updated.length);
            return updated;
          });
        }
      } catch (err) {
        console.warn('Hand raise DataPacket notice:', err.message);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      mounted = false;
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [token, room, roomId, onHandRaiseCountChange]);

  const isMyHandRaised = queue.some((h) => h.userId === user.id);

  const handleToggleMyHand = async () => {
    setRaising(true);
    try {
      if (isMyHandRaised) {
        // Lower Hand
        await api.lowerHand(token, roomId);
        setQueue((prev) => prev.filter((h) => h.userId !== user.id));

        if (room?.localParticipant) {
          const encoder = new TextEncoder();
          const payload = encoder.encode(JSON.stringify({ type: 'HAND_LOWERED', userId: user.id }));
          room.localParticipant.publishData(payload, { topic: 'room-state:hand-raise', reliable: true });
        }
      } else {
        // Raise Hand (Server Stamps Monotonic Sequence)
        const res = await api.raiseHand(token, roomId);
        if (res.handRaise) {
          setQueue((prev) => [...prev.filter((h) => h.userId !== user.id), res.handRaise].sort((a, b) => a.sequenceNum - b.sequenceNum));

          if (room?.localParticipant) {
            const encoder = new TextEncoder();
            const payload = encoder.encode(JSON.stringify({ type: 'HAND_RAISED', handRaise: res.handRaise }));
            room.localParticipant.publishData(payload, { topic: 'room-state:hand-raise', reliable: true });
          }
        }
      }
    } catch (err) {
      console.warn('Hand raise action failed:', err.message);
    } finally {
      setRaising(false);
    }
  };

  const handleHostLowerHand = async (targetUserId) => {
    try {
      await api.lowerHand(token, roomId, targetUserId);
      setQueue((prev) => prev.filter((h) => h.userId !== targetUserId));

      if (room?.localParticipant) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(JSON.stringify({ type: 'HAND_LOWERED', userId: targetUserId }));
        room.localParticipant.publishData(payload, { topic: 'room-state:hand-raise', reliable: true });
      }
    } catch (err) {
      console.warn('Host lower hand failed:', err.message);
    }
  };

  return (
    <div className="chat-sidebar" style={{ zIndex: 1100, width: '320px' }}>
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
          <Hand size={18} color="#fbbf24" />
          <span>Speaker Queue ({queue.length})</span>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '12px', overflowY: 'auto', flex: 1 }}>
        {/* Toggle My Hand Button */}
        <button
          onClick={handleToggleMyHand}
          disabled={raising}
          className={isMyHandRaised ? 'btn-outline danger' : 'btn-primary'}
          style={{
            width: '100%',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '0.85rem',
            padding: '10px 14px',
            borderColor: isMyHandRaised ? '#f87171' : undefined,
            color: isMyHandRaised ? '#f87171' : undefined,
          }}
        >
          <Hand size={18} />
          {isMyHandRaised ? 'Lower My Hand' : '✋ Raise My Hand'}
        </button>

        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Ordered Speaker Queue
        </div>

        {queue.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '24px', fontSize: '0.8125rem' }}>
            No hands raised right now. Click "Raise My Hand" to request a turn to speak!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {queue.map((item, idx) => {
              const isMe = item.userId === user.id;

              return (
                <div
                  key={item.id || item.userId}
                  className="glass-card"
                  style={{
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: isMe ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.08)',
                    background: isMe ? 'rgba(251, 191, 36, 0.1)' : 'rgba(15, 23, 42, 0.8)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: idx === 0 ? '#fbbf24' : 'rgba(255,255,255,0.1)',
                        color: idx === 0 ? '#000' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: isMe ? '#fbbf24' : '#fff' }}>
                        {item.userName} {isMe && <span style={{ opacity: 0.7 }}>(you)</span>}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        Order Sequence: #{item.sequenceNum}
                      </div>
                    </div>
                  </div>

                  {isHost && (
                    <button
                      onClick={() => handleHostLowerHand(item.userId)}
                      className="btn-outline"
                      style={{ padding: '3px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px', borderRadius: '6px', color: '#a5b4fc' }}
                      title="Allow to speak / Lower hand"
                    >
                      <ArrowDownCircle size={12} /> Dismiss
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
