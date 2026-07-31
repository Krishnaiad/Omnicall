import { Monitor, X } from 'lucide-react';

export default function PresentationStage({ media, isPresenter, onStopPresentation }) {
  if (!media) return null;

  const isImage = media.mediaType && media.mediaType.startsWith('image/');
  const isVideo = media.mediaType && media.mediaType.startsWith('video/');

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
          <button className="btn-outline" onClick={onStopPresentation} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <X size={14} /> Stop Presentation
          </button>
        )}
      </div>

      <div className="presentation-body">
        {isImage ? (
          <img src={media.mediaUrl} alt={media.mediaName} className="presentation-media-img" />
        ) : isVideo ? (
          <video src={media.mediaUrl} controls autoPlay className="presentation-media-video" />
        ) : (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <audio src={media.mediaUrl} controls autoPlay />
            <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>{media.mediaName}</p>
          </div>
        )}
      </div>
    </div>
  );
}
