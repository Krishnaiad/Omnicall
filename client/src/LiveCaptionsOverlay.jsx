import { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { MessageSquareQuote, Mic, AlertTriangle, X } from 'lucide-react';

export default function LiveCaptionsOverlay({ room, user, isEnabled, onClose }) {
  const [activeCaptions, setActiveCaptions] = useState([]);
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef(null);

  // 1. Initialize Web Speech API for local speaker recognition (Best-effort $0 STT)
  useEffect(() => {
    if (!isEnabled) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const textToShow = finalTranscript || interimTranscript;
      if (!textToShow.trim()) return;

      const captionObj = {
        speakerId: user.id,
        speakerName: user.name,
        text: textToShow.trim(),
        timestamp: Date.now(),
      };

      // Update local caption overlay
      setActiveCaptions((prev) => [captionObj, ...prev.filter((c) => c.speakerId !== user.id)].slice(0, 3));

      // Broadcast over LiveKit DataChannel
      try {
        if (room?.localParticipant) {
          const encoder = new TextEncoder();
          const payload = encoder.encode(JSON.stringify({ type: 'CAPTION', ...captionObj }));
          room.localParticipant.publishData(payload, { topic: 'room-state:captions' });
        }
      } catch (err) {
        console.warn('Caption broadcast notice:', err.message);
      }
    };

    recognition.onerror = (err) => {
      if (err.error !== 'no-speech') {
        console.warn('Speech recognition notice:', err.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled
      if (isEnabled) {
        try { recognition.start(); } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (startErr) {
      console.warn('Speech recognition start notice:', startErr.message);
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, [isEnabled, room, user]);

  // 2. Listen to captions from peers
  useEffect(() => {
    if (!room || !isEnabled) return;

    const handleDataReceived = (payload, _participant, _kind, topic) => {
      if (topic !== 'room-state:captions') return;
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));
        if (data.type === 'CAPTION' && data.text) {
          setActiveCaptions((prev) => [data, ...prev.filter((c) => c.speakerId !== data.speakerId)].slice(0, 3));
        }
      } catch (err) {
        console.warn('Caption parse notice:', err.message);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, isEnabled]);

  // Auto-expire stale captions after 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setActiveCaptions((prev) => prev.filter((c) => now - c.timestamp < 5000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isEnabled) return null;

  return (
    <div style={{ position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 900, width: '90%', maxWidth: '700px', pointerEvents: 'none' }}>
      {!isSupported ? (
        <div
          className="glass-card"
          style={{
            padding: '10px 16px',
            background: 'rgba(239, 68, 68, 0.25)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'auto',
            borderRadius: '10px',
            fontSize: '0.8rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} color="#f87171" />
            <span>Live Captions are only supported on <strong>Chrome & Edge</strong> browsers.</span>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#fff', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      ) : activeCaptions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {activeCaptions.map((cap, idx) => (
            <div
              key={`${cap.speakerId}-${idx}`}
              className="glass-card"
              style={{
                padding: '8px 16px',
                background: 'rgba(0, 0, 0, 0.85)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '0.9rem',
                textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                animation: 'fadeIn 0.2s ease-out',
              }}
            >
              <strong style={{ color: '#818cf8', marginRight: '6px' }}>{cap.speakerName}:</strong>
              <span>{cap.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="glass-card"
          style={{
            padding: '6px 14px',
            background: 'rgba(0, 0, 0, 0.65)',
            color: 'var(--text-muted)',
            borderRadius: '20px',
            fontSize: '0.75rem',
            textAlign: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            margin: '0 auto',
          }}
        >
          <Mic size={12} color="#10b981" /> Live Captions listening…
        </div>
      )}
    </div>
  );
}
