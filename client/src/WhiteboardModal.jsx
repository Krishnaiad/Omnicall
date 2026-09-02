import { useEffect, useRef, useState, useCallback } from 'react';
import { RoomEvent } from 'livekit-client';
import { X, Trash2, Edit2, Eraser, Download, Camera, Users, Eye, EyeOff } from 'lucide-react';
import { api } from './api.js';

const COLORS = ['#ffffff', '#6366f1', '#ec4899', '#10b981', '#fbbf24', '#ef4444', '#38bdf8'];
const SIZES = [2, 4, 8, 14];

function MiniVideoTile({ trackItem }) {
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!trackItem?.track || !el || typeof trackItem.track.attach !== 'function') return;
    try {
      trackItem.track.attach(el);
    } catch {}
    return () => {
      if (typeof trackItem.track?.detach === 'function') {
        try {
          trackItem.track.detach(el);
        } catch {}
      }
    };
  }, [trackItem?.track]);

  const label = trackItem?.name || trackItem?.identity || 'Peer';

  return (
    <div className="wb-mini-tile">
      <video ref={elRef} autoPlay playsInline muted={trackItem?.isLocal} />
      <div className="wb-mini-label">{label}</div>
    </div>
  );
}

export default function WhiteboardModal({ token, room, roomId, isHost, videoTracks = [], onClose, isPresenter = true, presenterName = '', onTakeOver }) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const [selectedColor, setSelectedColor] = useState('#6366f1');
  const [selectedSize, setSelectedSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [showVideoRibbon, setShowVideoRibbon] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const drawSegment = useCallback((ctx, fromX, fromY, toX, toY, color, size) => {
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, []);

  const renderStroke = useCallback((ctx, stroke) => {
    if (!ctx || !stroke?.points || stroke.points.length < 2) return;
    const { points, color, size } = stroke;
    for (let i = 1; i < points.length; i++) {
      drawSegment(ctx, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, color, size);
    }
  }, [drawSegment]);

  const redrawAllStrokes = useCallback((strokes) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((s) => renderStroke(ctx, s));
  }, [renderStroke]);

  // 1. Fetch full stroke history on mount
  useEffect(() => {
    let mounted = true;
    const loadHistory = async () => {
      try {
        const data = await api.getWhiteboard(token, roomId);
        if (mounted && data.strokes) {
          redrawAllStrokes(data.strokes);
        }
      } catch (err) {
        console.warn('Failed to load whiteboard history:', err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadHistory();

    // 2. Listen for real-time stroke broadcasts
    if (!room) return;

    const handleDataReceived = (payload, _participant, _kind, topic) => {
      if (topic !== 'room-state:whiteboard') return;
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (data.type === 'STROKE') {
          renderStroke(ctx, data.stroke);
        } else if (data.type === 'CLEAR') {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      } catch (err) {
        console.warn('Whiteboard DataPacket error:', err.message);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      mounted = false;
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [token, room, roomId, redrawAllStrokes, renderStroke]);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handleStartDraw = (e) => {
    e.preventDefault();
    isDrawingRef.current = true;
    const coords = getCanvasCoords(e);
    currentStrokeRef.current = [coords];
  };

  const handleDrawMove = (e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoords(e);
    const prevCoords = currentStrokeRef.current[currentStrokeRef.current.length - 1];

    const activeColor = isEraser ? '#070a13' : selectedColor;
    const activeSize = isEraser ? selectedSize * 3 : selectedSize;

    drawSegment(ctx, prevCoords.x, prevCoords.y, coords.x, coords.y, activeColor, activeSize);
    currentStrokeRef.current.push(coords);
  };

  const handleEndDraw = async (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const points = currentStrokeRef.current;
    if (points.length < 2) return;

    const activeColor = isEraser ? '#070a13' : selectedColor;
    const activeSize = isEraser ? selectedSize * 3 : selectedSize;

    const strokeObj = {
      points,
      color: activeColor,
      size: activeSize,
    };

    try {
      await api.saveWhiteboardStroke(token, roomId, strokeObj);
    } catch (err) {
      console.warn('Failed to persist stroke:', err.message);
    }

    try {
      if (room?.localParticipant) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(JSON.stringify({ type: 'STROKE', stroke: strokeObj }));
        room.localParticipant.publishData(payload, { topic: 'room-state:whiteboard', reliable: true });
      }
    } catch (err) {
      console.warn('Failed to broadcast stroke:', err.message);
    }
  };

  const handleClear = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    try {
      await api.clearWhiteboard(token, roomId);
      if (room?.localParticipant) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(JSON.stringify({ type: 'CLEAR' }));
        room.localParticipant.publishData(payload, { topic: 'room-state:whiteboard', reliable: true });
      }
    } catch (err) {
      console.error('Failed to clear canvas:', err);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnicall-whiteboard-${Date.now()}.png`;
    a.click();
  };

  const handleSaveToMemories = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');

    try {
      await api.saveMemory(token, {
        roomId,
        roomName: 'Whiteboard Drawing',
        mediaUrl: url,
        caption: 'Whiteboard Session Canvas',
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save to memories:', err);
    }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div className="glass-card" style={{ width: '95vw', maxWidth: '1100px', height: '90vh', display: 'flex', flexDirection: 'column', padding: '14px', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '1rem', color: '#a5b4fc' }}>
              <Edit2 size={18} color="#818cf8" /> Interactive In-Call Whiteboard
            </div>
            {presenterName && (
              <span className="badge" style={{ background: isPresenter ? 'var(--accent-bg)' : 'rgba(255,255,255,0.1)', color: isPresenter ? 'var(--accent)' : '#cbd5e1', fontSize: '0.75rem', fontWeight: 600 }}>
                {isPresenter ? '🎨 You are Presenting' : `✏️ ${presenterName} is Presenting (View-Only)`}
              </span>
            )}
            {!isPresenter && isHost && onTakeOver && (
              <button
                type="button"
                onClick={onTakeOver}
                className="btn-outline"
                style={{ padding: '3px 8px', fontSize: '0.75rem', color: '#f59e0b', borderColor: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Room Creator Authority: Take over presentation"
              >
                👑 Take Over
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {videoTracks.length > 0 && (
              <button
                className="btn-outline"
                onClick={() => setShowVideoRibbon((prev) => !prev)}
                title="Toggle In-Call Video Ribbon"
                style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {showVideoRibbon ? <EyeOff size={13} /> : <Eye size={13} />}
                {showVideoRibbon ? 'Hide Video' : 'Show Video'}
              </button>
            )}

            <button
              className="btn-outline"
              onClick={handleSaveToMemories}
              title="Save Canvas Snapshot to Personal Room Memories"
              style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: '#6ee7b7', borderColor: 'rgba(16,185,129,0.4)' }}
            >
              <Camera size={13} /> {saveSuccess ? 'Saved to Memories!' : 'Save Memory'}
            </button>

            <button className="btn-outline" onClick={handleDownload} title="Export Drawing as PNG" style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={13} /> Export PNG
            </button>

            {isPresenter && (
              <button className="btn-outline danger" onClick={handleClear} title="Clear Canvas" style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}>
                <Trash2 size={13} /> Clear
              </button>
            )}

            <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)', marginLeft: '6px' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Live Video Ribbon: Participants remain clearly visible while drawing! */}
        {showVideoRibbon && videoTracks.length > 0 && (
          <div className="wb-video-ribbon" style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <Users size={12} /> Live ({videoTracks.length}):
            </span>
            {videoTracks.map((item) => (
              <MiniVideoTile key={item.sid} trackItem={item} />
            ))}
          </div>
        )}

        {/* Toolbar */}
        {isPresenter ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                className={`btn-outline ${!isEraser ? 'active' : ''}`}
                onClick={() => setIsEraser(false)}
                style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Edit2 size={12} /> Pen
              </button>
              <button
                type="button"
                className={`btn-outline ${isEraser ? 'active' : ''}`}
                onClick={() => setIsEraser(true)}
                style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Eraser size={12} /> Eraser
              </button>
            </div>

            {!isEraser && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Color:</span>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: c,
                      border: selectedColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                      transform: selectedColor === c ? 'scale(1.15)' : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Size:</span>
              {SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSelectedSize(s)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: selectedSize === s ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                    color: selectedSize === s ? '#a5b4fc' : 'var(--text-muted)',
                    border: selectedSize === s ? '1px solid #818cf8' : '1px solid transparent',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                  }}
                >
                  {s}px
                </button>
              ))}
            </div>

            {loading && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Syncing canvas…</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: '10px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Viewing live presentation from <strong>{presenterName || 'Presenter'}</strong>. Drawing is locked to the active presenter.
            </span>
            {loading && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Syncing canvas…</span>}
          </div>
        )}

        {/* Canvas Element */}
        <div style={{ flex: 1, position: 'relative', background: '#070a13', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={1600}
            height={900}
            style={{ width: '100%', height: '100%', cursor: isPresenter ? (isEraser ? 'cell' : 'crosshair') : 'default', display: 'block' }}
            onMouseDown={isPresenter ? handleStartDraw : undefined}
            onMouseMove={isPresenter ? handleDrawMove : undefined}
            onMouseUp={isPresenter ? handleEndDraw : undefined}
            onMouseLeave={isPresenter ? handleEndDraw : undefined}
            onTouchStart={isPresenter ? handleStartDraw : undefined}
            onTouchMove={isPresenter ? handleDrawMove : undefined}
            onTouchEnd={isPresenter ? handleEndDraw : undefined}
          />
        </div>
      </div>
    </div>
  );
}
