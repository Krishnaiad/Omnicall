import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Film, Play, StopCircle, X } from 'lucide-react';
import { LocalVideoTrack } from 'livekit-client';

export default function MediaInjector({ token, room, onClose, onActiveStateChange }) {
  const [clips, setClips] = useState([]);
  const [activeClipId, setActiveClipId] = useState(null);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef(null);

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

  const handleInjectClip = async (clip) => {
    if (!room || !videoRef.current) return;

    try {
      const streamUrl = api.getStreamUrl(token, clip.id);
      const videoEl = videoRef.current;

      videoEl.crossOrigin = 'anonymous';
      videoEl.src = streamUrl;
      videoEl.loop = true;
      await videoEl.play();

      // Capture canvas stream or video element media stream
      const stream = videoEl.captureStream ? videoEl.captureStream(30) : videoEl.mozCaptureStream(30);
      const videoTrack = stream.getVideoTracks()[0];

      if (videoTrack) {
        // Create LiveKit LocalVideoTrack wrapped around captured stream track
        const lkTrack = new LocalVideoTrack(videoTrack);
        
        // Unpublish current camera track if active
        const existingPubs = Array.from(room.localParticipant.videoTrackPublications.values());
        for (const pub of existingPubs) {
          if (pub.track) {
            await room.localParticipant.unpublishTrack(pub.track);
          }
        }

        // Publish transcoded clip track to room
        await room.localParticipant.publishTrack(lkTrack);
        setActiveClipId(clip.id);
        if (onActiveStateChange) onActiveStateChange(true);
      }
    } catch (err) {
      console.error('Clip injection failed:', err);
      alert(`Could not inject clip: ${err.message}`);
    }
  };

  const handleStopClip = async () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }

    if (room) {
      // Re-enable camera track
      await room.localParticipant.setCameraEnabled(true);
    }
    setActiveClipId(null);
    if (onActiveStateChange) onActiveStateChange(false);
  };

  return (
    <div className="glass-card injector-popover">
      {/* Hidden video element for track stream capture */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Film size={18} color="#ec4899" /> Inject Media Clip
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Select a server-transcoded clip from your library to inject into your video stream:
      </p>

      {loading ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading library clips...</p>
      ) : clips.length === 0 ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No ready clips found in your library. Upload clips in the dashboard prior to joining.</p>
      ) : (
        <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {clips.map((clip) => {
            const isPlaying = activeClipId === clip.id;
            return (
              <div
                key={clip.id}
                style={{
                  display: 'flex',
                  justify: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: isPlaying ? 'rgba(236, 72, 153, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: isPlaying ? '1px solid rgba(236, 72, 153, 0.5)' : '1px solid transparent',
                }}
              >
                <span style={{ fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                  {clip.name}
                </span>

                {isPlaying ? (
                  <button className="btn-outline" onClick={handleStopClip} style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: '#f472b6' }}>
                    <StopCircle size={14} /> Stop
                  </button>
                ) : (
                  <button className="btn-outline" onClick={() => handleInjectClip(clip)} style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Play size={14} /> Stream
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
