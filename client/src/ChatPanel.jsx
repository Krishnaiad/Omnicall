import { useEffect, useState, useRef } from 'react';
import { RoomEvent } from 'livekit-client';
import { Send, X, Smile } from 'lucide-react';
import { api } from './api.js';

const EMOJI_CATEGORIES = [
  {
    name: 'Top Reactions',
    emojis: ['👍', '❤️', '🔥', '🎉', '👏', '🙌', '🚀', '💯', '✨', '💡', '✅', '❌'],
  },
  {
    name: 'Faces & Expressions',
    emojis: ['😊', '😂', '🤣', '😎', '😍', '🤔', '🤯', '🥳', '😭', '😇', '😴', '🤫'],
  },
  {
    name: 'Gestures & Work',
    emojis: ['👋', '🤝', '✌️', '💪', '🙏', '👀', '📌', '💻', '⚡', '🌟', '🎯', '👑'],
  },
  {
    name: 'Fun & Snacks',
    emojis: ['☕', '🍕', '🍿', '🍻', '🍩', '💎', '🦄', '🎮', '🎵', '🏆', '🎈', '🪄'],
  },
];

export default function ChatPanel({ token, room, user, roomId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    // 1. Fetch persistent chat history from PostgreSQL via HTTP REST API
    const fetchHistory = async () => {
      try {
        const data = await api.getRoomMessages(token, roomId);
        if (data.messages) setMessages(data.messages);
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    };

    fetchHistory();

    if (!room) return;

    // 2. Listen for real-time in-call DataPackets from LiveKit WebRTC DataChannel (0ms delay)
    const handleDataReceived = (payload, participant, _kind, topic) => {
      if (topic !== 'in-call-chat') return;
      try {
        const decoder = new TextDecoder();
        const msgObj = JSON.parse(decoder.decode(payload));
        setMessages((prev) => {
          if (prev.some((m) => m.id === msgObj.id)) return prev;
          return [...prev, msgObj];
        });
      } catch (err) {
        console.warn('In-call chat DataPacket parse notice:', err.message);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [token, room, roomId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !room) return;

    const msgText = input.trim();
    const tempId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const optimisticMsg = {
      id: tempId,
      senderId: user.id,
      senderName: user.name,
      text: msgText,
      timestamp: new Date().toISOString(),
      _pending: true, // Visual indicator while persisting
    };

    // 1. Optimistic local render immediately so UI feels instant
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput('');

    // 2. Persist to PostgreSQL FIRST — ensures late joiners see this message in history
    let confirmedId = tempId;
    let persistOk = false;
    try {
      const saved = await api.sendRoomMessage(token, roomId, tempId, msgText);
      confirmedId = saved?.id || tempId;
      persistOk = true;

      // Update local message: remove pending flag, use server-confirmed ID
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: confirmedId, _pending: false } : m))
      );
    } catch (dbErr) {
      console.error('[Chat] Failed to persist message to PostgreSQL:', dbErr);
      // Mark message as failed but keep it visible (don't silently drop)
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
      );
    }

    // 3. Broadcast via LiveKit DataChannel AFTER persist — other call participants receive it
    //    We broadcast even on persist failure so in-call participants still see the message,
    //    but the _failed flag tells the sender that history will be incomplete.
    try {
      const encoder = new TextEncoder();
      const broadcastMsg = {
        id: confirmedId,
        senderId: user.id,
        senderName: user.name,
        text: msgText,
        timestamp: new Date().toISOString(),
        _persisted: persistOk,
      };
      room.localParticipant.publishData(encoder.encode(JSON.stringify(broadcastMsg)), { topic: 'in-call-chat' });
    } catch (err) {
      console.warn('[Chat] LiveKit DataPacket broadcast failed:', err.message);
    }
  };


  const handleInsertEmoji = (emoji) => {
    setInput((prev) => prev + emoji);
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <span>In-Call Chat</span>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '20px' }}>
            No messages yet. Send a message or emoji to start chatting!
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="chat-msg" style={{ opacity: msg._pending ? 0.6 : 1 }}>
              <div className="chat-msg-sender" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {msg.senderName}
                {msg._pending && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>saving…</span>
                )}
                {msg._failed && (
                  <span
                    style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 600 }}
                    title="Message could not be saved to history. Others in the call can still see it."
                  >
                    ⚠ not saved
                  </span>
                )}
              </div>
              <div>{msg.text}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Emoji Toggle Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', background: 'rgba(0,0,0,0.2)' }}>
        <button
          type="button"
          onClick={() => setShowEmojis((prev) => !prev)}
          style={{ background: 'transparent', border: 'none', color: showEmojis ? '#818cf8' : 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600 }}
          title="Toggle Emoji Tray"
        >
          <Smile size={18} /> {showEmojis ? 'Hide Emojis' : 'Emoji Tray'}
        </button>

        {/* Quick Reaction Bar */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {['👍', '❤️', '🔥', '🎉'].map((quickEmoji) => (
            <button
              key={quickEmoji}
              type="button"
              onClick={() => handleInsertEmoji(quickEmoji)}
              style={{ background: 'transparent', border: 'none', fontSize: '1rem', cursor: 'pointer', padding: '2px', transition: 'transform 0.15s ease' }}
              className="quick-emoji-btn"
            >
              {quickEmoji}
            </button>
          ))}
        </div>
      </div>

      {/* Expanded Categorized Emoji Panel */}
      {showEmojis && (
        <div style={{ padding: '8px 12px', background: 'rgba(15, 23, 42, 0.95)', borderTop: '1px solid rgba(255, 255, 255, 0.08)', animation: 'slideUpTray 0.2s ease-out' }}>
          {/* Category Tabs */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {EMOJI_CATEGORIES.map((cat, idx) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => setActiveCategory(idx)}
                style={{
                  fontSize: '0.725rem',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  whiteSpace: 'nowrap',
                  background: activeCategory === idx ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                  color: activeCategory === idx ? '#a5b4fc' : 'var(--text-muted)',
                  border: activeCategory === idx ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Emoji Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
            {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleInsertEmoji(emoji)}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  fontSize: '1.25rem',
                  padding: '6px 0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 0.15s ease, background 0.15s ease',
                }}
                className="emoji-grid-btn"
                title={`Add ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          className="form-control"
          placeholder="Type a message or react..."
          style={{ fontSize: '0.8125rem' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '8px 14px' }}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
