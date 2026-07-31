import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import DOMPurify from 'dompurify';
import { Send, X } from 'lucide-react';

export default function ChatPanel({ token, roomId, onClose }) {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

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
            No messages yet. Send a message to start chatting!
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
