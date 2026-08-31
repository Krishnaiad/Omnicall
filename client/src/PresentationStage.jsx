import { useState, useRef } from 'react';
import { Monitor, X, Maximize2, Minimize2, RotateCcw } from 'lucide-react';

export default function PresentationStage({ media, isPresenter, onStopPresentation }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const containerRef = useRef(null);
  const mediaRef = useRef(null);

  if (!media) return null;

  const isImage = media.mediaType && (media.mediaType.startsWith('image/') || (media.mediaUrl && media.mediaUrl.match(/\.(png|jpe?g|webp|gif)$/i)));
  const isVideo = media.mediaType && media.mediaType.startsWith('video/') && !media.mediaType.includes('screenshare');

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch((err) => console.warn(err));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch((err) => console.warn(err));
    }
  };

  const handleMediaError = (e) => {
    console.warn('Presentation stage media error (presigned URL may have expired):', e);
  };

  return (
    <div ref={containerRef} className={`presentation-stage-container ${isFullscreen ? 'fullscreen-stage' : ''}`}>
      <div className="presentation-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Monitor size={18} color="#ec4899" />
          <span>Shared Presentation Stage: {media.mediaName}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.8, color: '#a5b4fc', marginLeft: '8px' }}>
            (Presented by {media.presenterName})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isVideo && (
            <button
              className="btn-outline"
              onClick={() => setIsLooping((prev) => !prev)}
              style={{ padding: '4px 8px', fontSize: '0.75rem', color: isLooping ? '#818cf8' : 'var(--text-muted)', borderColor: isLooping ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)' }}
              title="Toggle Video Loop"
            >
              <RotateCcw size={14} /> {isLooping ? 'Looping' : 'Once'}
            </button>
          )}

          <button
            className="btn-outline"
            onClick={toggleFullscreen}
            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
            title={isFullscreen ? 'Exit Fullscreen Mode' : 'Fullscreen Presentation'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          {isPresenter && (
            <button className="btn-outline" onClick={onStopPresentation} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(239,68,68,0.4)' }}>
              <X size={14} /> Stop Presentation
            </button>
          )}
        </div>
      </div>

      <div className="presentation-body" style={{ background: '#090d16', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
        {isImage ? (
          <img
            ref={mediaRef}
            src={media.mediaUrl}
            alt={media.mediaName}
            className="presentation-media-img"
            onError={handleMediaError}
            style={{ maxHeight: isFullscreen ? '85vh' : '65vh', width: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          />
        ) : isVideo ? (
          <video
            ref={mediaRef}
            src={media.mediaUrl}
            controls
            autoPlay
            loop={isLooping}
            className="presentation-media-video"
            onError={handleMediaError}
            style={{ maxHeight: isFullscreen ? '85vh' : '65vh', width: '100%', borderRadius: '8px' }}
          />
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', width: '100%' }}>
            <audio ref={mediaRef} src={media.mediaUrl} controls autoPlay loop={isLooping} onError={handleMediaError} style={{ width: '80%', maxWidth: '500px' }} />
            <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{media.mediaName}</p>
          </div>
        )}
      </div>
    </div>
  );
}
