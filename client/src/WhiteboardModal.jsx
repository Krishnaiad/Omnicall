import { useEffect, useRef, useState, useCallback } from 'react';
import { RoomEvent } from 'livekit-client';
import { X, Trash2, Edit2, Eraser, Download, Circle } from 'lucide-react';
import { api } from './api.js';

const COLORS = ['#ffffff', '#6366f1', '#ec4899', '#10b981', '#fbbf24', '#ef4444', '#38bdf8'];
const SIZES = [2, 4, 8, 14];

export default function WhiteboardModal({ token, room, roomId, isHost, onClose }) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const [selectedColor, setSelectedColor] = useState('#6366f1');
  const [selectedSize, setSelectedSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [loading, setLoading] = useState(true);

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

  // 1. Fetch full stroke history on mount (Late-Joiner State Recovery)
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

    // 2. Listen for real-time stroke broadcasts from peers over LiveKit Reliable DataChannel
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

    // A. Persist to Postgres FIRST (canonical state)
    try {
      await api.saveWhiteboardStroke(token, roomId, strokeObj);
    } catch (err) {
      console.warn('Failed to persist stroke:', err.message);
    }

    // B. Broadcast over LiveKit Reliable DataChannel
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

  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div className="glass-card" style={{ width: '92vw', maxWidth: '1000px', height: '88vh', display: 'flex', flexDirection: 'column', padding: '16px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.05rem', color: '#a5b4fc' }}>
            <Edit2 size={20} color="#818cf8" /> Interactive In-Call Whiteboard
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn-outline" onClick={handleDownload} title="Export Drawing as PNG" style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={14} /> Export PNG
            </button>
            <button className="btn-outline danger" onClick={handleClear} title="Clear Canvas" style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}>
              <Trash2 size={14} /> Clear
            </button>
            <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)', marginLeft: '8px' }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.3)', padding: '8px 14px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className={`btn-outline ${!isEraser ? 'active' : ''}`}
              onClick={() => setIsEraser(false)}
              style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Edit2 size={12} /> Pen
            </button>
            <button
              type="button"
              className={`btn-outline ${isEraser ? 'active' : ''}`}
              onClick={() => setIsEraser(true)}
              style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Eraser size={12} /> Eraser
            </button>
          </div>

          {!isEraser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Color:</span>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: c,
                    border: selectedColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                    transform: selectedColor === c ? 'scale(1.2)' : 'none',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Thickness:</span>
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelectedSize(s)}
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: selectedSize === s ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                  color: selectedSize === s ? '#a5b4fc' : 'var(--text-muted)',
                  border: selectedSize === s ? '1px solid #818cf8' : '1px solid transparent',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {s}px
              </button>
            ))}
          </div>

          {loading && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Loading strokes…</span>}
        </div>

        {/* Canvas Element */}
        <div style={{ flex: 1, position: 'relative', background: '#070a13', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={1600}
            height={900}
            style={{ width: '100%', height: '100%', cursor: isEraser ? 'cell' : 'crosshair', display: 'block' }}
            onMouseDown={handleStartDraw}
            onMouseMove={handleDrawMove}
            onMouseUp={handleEndDraw}
            onMouseLeave={handleEndDraw}
            onTouchStart={handleStartDraw}
            onTouchMove={handleDrawMove}
            onTouchEnd={handleEndDraw}
          />
        </div>
      </div>
    </div>
  );
}
