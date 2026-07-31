import { Monitor, X } from 'lucide-react';

export default function PresentationStage({ media, isPresenter, onStopPresentation }) {
  if (!media) return null;

  const isImage = media.mediaType && (media.mediaType.startsWith('image/') || media.mediaUrl.match(/\.(png|jpe?g|webp|gif)$/i));
  const isVideo = media.mediaType && media.mediaType.startsWith('video/') && !media.mediaType.includes('screenshare');

  return (
    <div className="presentation-stage-container">
      <div className="presentation-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Monitor size={18} color="#ec4899" />
          <span>Shared Presentation Stage: {media.mediaName}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.8, color: '#a5b4fc', marginLeft: '8px' }}>
            (Presented by {media.presenterName})
          </span>
        </div>

        {isPresenter && (
          <button className="btn-outline" onClick={onStopPresentation} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(239,68,68,0.4)' }}>
            <X size={14} /> Stop Presentation
          </button>
        )}
      </div>

      <div className="presentation-body" style={{ background: '#090d16', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
        {isImage ? (
          <img
            src={media.mediaUrl}
            alt={media.mediaName}
            className="presentation-media-img"
            style={{ maxHeight: '65vh', width: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          />
        ) : isVideo ? (
          <video
            src={media.mediaUrl}
            controls
            autoPlay
            className="presentation-media-video"
            style={{ maxHeight: '65vh', width: '100%', borderRadius: '8px' }}
          />
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', width: '100%' }}>
            <audio src={media.mediaUrl} controls autoPlay style={{ width: '80%', maxWidth: '500px' }} />
            <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{media.mediaName}</p>
          </div>
        )}
      </div>
    </div>
  );
}
