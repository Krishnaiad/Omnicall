import { useEffect, useState, useRef } from 'react';
import { RoomEvent } from 'livekit-client';
import { Send, X, Smile, Paperclip } from 'lucide-react';
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

function getRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const date = new Date(timestamp);
  const diffSec = Math.floor((now - date.getTime()) / 1000);

  if (isNaN(diffSec) || diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({ token, room, user, roomId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [, setTick] = useState(0);
  const messagesEndRef = useRef(null);

  // Single shared 30s tick to keep all relative timestamps fresh without per-message timers
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

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
    if ((!input.trim() && !attachment) || !room) return;

    const msgText = input.trim();
    const currentAttachment = attachment;
    
    const tempId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const optimisticMsg = {
      id: tempId,
      senderId: user.id,
      senderName: user.name,
      text: msgText,
      attachment_url: currentAttachment ? URL.createObjectURL(currentAttachment) : null,
      timestamp: new Date().toISOString(),
      _pending: true, // Visual indicator while persisting
    };

    // 1. Optimistic local render immediately so UI feels instant
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput('');
    setAttachment(null);
    setUploading(true);

    // 2. Persist to PostgreSQL FIRST — ensures late joiners see this message in history
    let confirmedId = tempId;
    let persistOk = false;
    let uploadedUrl = null;
    try {
      if (currentAttachment) {
        const formData = new FormData();
        formData.append('file', currentAttachment);
        const uploadRes = await api.uploadChatAttachment(token, roomId, formData);
        uploadedUrl = uploadRes.url;
      }
      
      const saved = await api.sendRoomMessage(token, roomId, tempId, msgText, uploadedUrl);
      confirmedId = saved?.id || tempId;
      persistOk = true;

      // Update local message: remove pending flag, use server-confirmed ID
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: confirmedId, _pending: false, attachment_url: uploadedUrl || m.attachment_url } : m))
      );
    } catch (dbErr) {
      console.error('[Chat] Failed to persist message to PostgreSQL:', dbErr);
      // Mark message as failed but keep it visible (don't silently drop)
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
      );
    } finally {
      setUploading(false);
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
        attachment_url: uploadedUrl,
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

      <div className="chat-messages" aria-live="polite" aria-atomic="false">
        {messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '20px' }}>
            No messages yet. Send a message, file, or emoji to start chatting!
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="chat-msg" style={{ opacity: msg._pending ? 0.6 : 1 }}>
              <div className="chat-msg-sender" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600 }}>{msg.senderName}</span>
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
                {msg.timestamp && (
                  <span
                    title={new Date(msg.timestamp).toLocaleString()}
                    style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 400, cursor: 'default' }}
                  >
                    {getRelativeTime(msg.timestamp)}
                  </span>
                )}
              </div>
              <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.text}</div>
              {msg.attachment_url && (
                <div style={{ marginTop: '8px' }}>
                  {msg.attachment_url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) ? (
                    <img src={msg.attachment_url} alt="attachment" style={{ maxWidth: '100%', borderRadius: '6px' }} />
                  ) : (
                    <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: '0.8rem' }}>
                      📎 View Attachment
                    </a>
                  )}
                </div>
              )}
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

      <form className="chat-input-row" onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.75rem' }}>
            <Paperclip size={14} color="#818cf8" />
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.name}</span>
            <button type="button" onClick={() => setAttachment(null)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px' }}><X size={14} /></button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Paperclip size={18} />
            <input type="file" onChange={(e) => setAttachment(e.target.files?.[0])} style={{ display: 'none' }} accept="image/*, .pdf, .txt, .csv" />
          </label>
          <input
            className="form-control"
            placeholder="Type a message or react..."
            style={{ fontSize: '0.8125rem', flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={uploading} className="btn-primary" style={{ width: 'auto', padding: '8px 14px' }}>
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
