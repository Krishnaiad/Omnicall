import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Film, Play, StopCircle, X, Monitor, Upload, Cloud, AlertCircle, Sparkles } from 'lucide-react';
import { LocalVideoTrack } from 'livekit-client';

export default function MediaInjector({ token, room, onClose, onActiveStateChange, onSharePresentation }) {
  const [clips, setClips] = useState([]);
  const [activeTileMediaId, setActiveTileMediaId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  const loadClips = async () => {
    try {
      const data = await api.listClips(token);
      setClips((data.clips || []).filter((c) => c.status === 'ready'));
    } catch (err) {
      console.error('Failed to load server clips:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClips();
  }, [token]);

  // Direct In-Call File Upload
  const handleInCallUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('clip', selectedFile);

    try {
      const res = await api.uploadClip(token, formData);
      setSelectedFile(null);
      setSuccess('Uploaded! Sharing to call stage...');
      await loadClips();
      
      // Auto-broadcast the newly uploaded file to the presentation stage
      if (res.file) {
        const streamUrl = res.file.publicUrl || api.getStreamUrl(token, res.file.id);
        if (onSharePresentation) {
          onSharePresentation(streamUrl, res.file.name, res.file.mimeType);
        }
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const [isTileLooping, setIsTileLooping] = useState(false);

  // Option A: Tile Stream Injection (Image, Video, Audio)
  const handleTileStream = async (clip) => {
    if (!room) return;
    const isImage = clip.mimeType.startsWith('image/');
    const streamUrl = clip.publicUrl || api.getStreamUrl(token, clip.id);

    try {
      let streamTrack = null;

      if (isImage) {
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
        const videoEl = videoRef.current;
        videoEl.crossOrigin = 'anonymous';
        videoEl.src = streamUrl;
        videoEl.loop = isTileLooping;
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
      const existingPubs = Array.from(room.localParticipant.videoTrackPublications.values());
      for (const pub of existingPubs) {
        if (pub.track) {
          await room.localParticipant.unpublishTrack(pub.track, true);
          try { pub.track.stop(); } catch {}
        }
      }
      await room.localParticipant.setCameraEnabled(true);
    }
    setActiveTileMediaId(null);
    if (onActiveStateChange) onActiveStateChange(false);
  };

  // Option B: Shared Presentation Stage Broadcast
  const handleSharePresentation = (clip) => {
    const streamUrl = clip.publicUrl || api.getStreamUrl(token, clip.id);
    if (onSharePresentation) {
      onSharePresentation(streamUrl, clip.name, clip.mimeType);
    }
  };

  return (
    <div className="glass-card injector-popover" style={{ width: '420px', maxWidth: '92vw', padding: '16px' }}>
      {/* Hidden media elements for canvas/stream capture (opacity 0 avoids captureStream freeze on mobile/safari) */}
      <video ref={videoRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '10px', height: '10px' }} playsInline muted />
      <canvas ref={canvasRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '10px', height: '10px' }} />
      <img ref={imageRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '10px', height: '10px' }} alt="" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--text-main)', fontSize: '1rem' }}>
          <Film size={18} color="var(--text-muted)" /> Media & Presentation Stage
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      {/* In-Call Direct File Upload Box */}
      <form onSubmit={handleInCallUpload} style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '14px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Upload size={13} /> Upload & Share New File Right Now:
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <label style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px dashed rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.03)',
            color: selectedFile ? 'var(--text-main)' : 'var(--text-muted)',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}>
            <Upload size={13} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedFile ? selectedFile.name : 'Choose File...'}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp3"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="btn-primary"
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
          >
            {uploading ? 'Uploading...' : 'Present'}
          </button>
        </div>
        {error && <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: '6px' }}>{error}</div>}
        {success && <div style={{ fontSize: '0.7rem', color: 'var(--success)', marginTop: '6px' }}>{success}</div>}
      </form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
          Or select a previously uploaded file:
        </p>
        <label style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isTileLooping} onChange={(e) => setIsTileLooping(e.target.checked)} />
          Loop Tile Stream
        </label>
      </div>

      {loading ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading media files...</p>
      ) : clips.length === 0 ? (
        <div style={{ padding: '14px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
            No previous files in library. Use the upload box above to present any file instantly!
          </p>
        </div>
      ) : (
        <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {clips.map((clip) => {
            const isPlayingInTile = activeTileMediaId === clip.id;
            return (
              <div
                key={clip.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: isPlayingInTile ? 'rgba(124, 58, 237, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  border: isPlayingInTile ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }} title={clip.name}>
                  {clip.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({clip.mimeType})</span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {isPlayingInTile ? (
                    <button className="btn-outline" onClick={handleStopTileStream} style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                      <StopCircle size={13} /> Stop Tile
                    </button>
                  ) : (
                    <button className="btn-outline" onClick={() => handleTileStream(clip)} style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <Play size={13} /> Tile Stream
                    </button>
                  )}

                  <button
                    className="btn-primary"
                    onClick={() => handleSharePresentation(clip)}
                    style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                  >
                    <Monitor size={13} /> Present Stage
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
