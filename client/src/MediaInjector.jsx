import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Film, Play, StopCircle, X, Monitor, Image as ImageIcon } from 'lucide-react';
import { LocalVideoTrack } from 'livekit-client';

export default function MediaInjector({ token, room, onClose, onActiveStateChange, onSharePresentation }) {
  const [clips, setClips] = useState([]);
  const [activeTileMediaId, setActiveTileMediaId] = useState(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    async function loadClips() {
      try {
        const data = await api.listClips(token);
        setClips((data.clips || []).filter((c) => c.status === 'ready'));
      } catch (err) {
        console.error('Failed to load server clips:', err);
      } finally {
        setLoading(false);
      }
    }
    loadClips();
  }, [token]);

  // Option A: Tile Stream Injection (Image, Video, Audio)
  const handleTileStream = async (clip) => {
    if (!room) return;
    const isImage = clip.mimeType.startsWith('image/');
    const streamUrl = api.getStreamUrl(token, clip.id);

    try {
      let streamTrack = null;

      if (isImage) {
        // Image Canvas Stream Injection
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = streamUrl;
        await new Promise((res) => { img.onload = res; });

        const canvas = canvasRef.current;
        canvas.width = img.naturalWidth || 640;
        canvas.height = img.naturalHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const canvasStream = canvas.captureStream ? canvas.captureStream(30) : canvas.mozCaptureStream(30);
        streamTrack = canvasStream.getVideoTracks()[0];
      } else {
        // Video Stream Injection
        const videoEl = videoRef.current;
        videoEl.crossOrigin = 'anonymous';
        videoEl.src = streamUrl;
        videoEl.loop = true;
        await videoEl.play();

        const videoStream = videoEl.captureStream ? videoEl.captureStream(30) : videoEl.mozCaptureStream(30);
        streamTrack = videoStream.getVideoTracks()[0];
      }

      if (streamTrack) {
        const lkTrack = new LocalVideoTrack(streamTrack);
        const existingPubs = Array.from(room.localParticipant.videoTrackPublications.values());
        for (const pub of existingPubs) {
          if (pub.track) {
            await room.localParticipant.unpublishTrack(pub.track);
          }
        }
        await room.localParticipant.publishTrack(lkTrack);
        setActiveTileMediaId(clip.id);
        if (onActiveStateChange) onActiveStateChange(true);
      }
    } catch (err) {
      console.error('Tile stream injection failed:', err);
      alert(`Could not stream media into tile: ${err.message}`);
    }
  };

  const handleStopTileStream = async () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    if (room) {
      await room.localParticipant.setCameraEnabled(true);
    }
    setActiveTileMediaId(null);
    if (onActiveStateChange) onActiveStateChange(false);
  };

  // Option B: Shared Presentation Stage Broadcast
  const handleSharePresentation = (clip) => {
    const streamUrl = api.getStreamUrl(token, clip.id);
    if (onSharePresentation) {
      onSharePresentation(streamUrl, clip.name, clip.mimeType);
    }
  };

  return (
    <div className="glass-card injector-popover" style={{ width: '400px' }}>
      {/* Hidden media elements for canvas/stream capture */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <img ref={imageRef} style={{ display: 'none' }} alt="" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Film size={18} color="#ec4899" /> Media Library Injector
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Select any uploaded Image, Video, or Audio to <strong>Tile Stream</strong> (video grid) or <strong>Share to Presentation Stage</strong> (high-res stage for everyone).
      </p>

      {loading ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading media library...</p>
      ) : clips.length === 0 ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No media files found in your library. Upload images/videos in the dashboard.</p>
      ) : (
        <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {clips.map((clip) => {
            const isPlayingInTile = activeTileMediaId === clip.id;
            return (
              <div
                key={clip.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '10px',
                  borderRadius: '8px',
                  background: isPlayingInTile ? 'rgba(236, 72, 153, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: isPlayingInTile ? '1px solid rgba(236, 72, 153, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clip.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({clip.mimeType})</span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {isPlayingInTile ? (
                    <button className="btn-outline" onClick={handleStopTileStream} style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: '#f472b6' }}>
                      <StopCircle size={14} /> Stop Tile Stream
                    </button>
                  ) : (
                    <button className="btn-outline" onClick={() => handleTileStream(clip)} style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <Play size={14} /> Tile Stream
                    </button>
                  )}

                  <button
                    className="btn-primary"
                    onClick={() => handleSharePresentation(clip)}
                    style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'linear-gradient(135deg, #ec4899, #818cf8)' }}
                  >
                    <Monitor size={14} /> Presentation Stage
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
