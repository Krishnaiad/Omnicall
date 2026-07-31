import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import DOMPurify from 'dompurify';
import { Send, X, Smile } from 'lucide-react';

const EMOJIS = ['😊', '👍', '❤️', '🎉', '🚀', '😂', '👏', '🔥', '🙌', '💡'];

export default function ChatPanel({ token, roomId, onClose }) {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showEmojis, setShowEmojis] = useState(true);

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const s = io(serverUrl, {
      auth: { token },
    });

    s.on('connect', () => {
      s.emit('join-room', { roomId });
    });

    s.on('new-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token, roomId]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit('send-message', { roomId, text: input });
    setInput('');
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
            <div key={msg.id} className="chat-msg">
              <div className="chat-msg-sender">{msg.senderName}</div>
              <div
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(msg.text),
                }}
              />
            </div>
          ))
        )}
      </div>

      {showEmojis && (
        <div style={{ display: 'flex', gap: '4px', padding: '6px 12px', background: 'rgba(255, 255, 255, 0.03)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', overflowX: 'auto' }}>
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleInsertEmoji(emoji)}
              style={{ background: 'transparent', border: 'none', fontSize: '1.1rem', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
              title={`Add ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          className="form-control"
          placeholder="Type a message..."
          style={{ fontSize: '0.8125rem' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '8px 12px' }}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
