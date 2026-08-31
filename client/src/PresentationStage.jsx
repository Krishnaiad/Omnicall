import { useState, useRef } from 'react';
import { Monitor, X, Maximize2, Minimize2, RotateCcw, Download, Camera, Eye, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from './api.js';

export default function PresentationStage({ media, isPresenter, token, roomId, roomName, onStopPresentation }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState('');
  const [manualPreview, setManualPreview] = useState(false);
  const containerRef = useRef(null);
  const mediaRef = useRef(null);

  if (!media) return null;

  const isImage = media.mediaType && (media.mediaType.startsWith('image/') || (media.mediaUrl && media.mediaUrl.match(/\.(png|jpe?g|webp|gif)$/i)));
  const isVideo = media.mediaType && media.mediaType.startsWith('video/') && !media.mediaType.includes('screenshare');
  const isScreenshare = media.mediaType === 'video/screenshare';

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch((err) => console.warn(err));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch((err) => console.warn(err));
    }
  };

  const handleDownloadAndSaveToMemories = async () => {
    if (!media.mediaUrl) return;
    setDownloading(true);
    setDownloadNotice('');

    try {
      // 1. Fetch headers to check 20MB limit
      const response = await fetch(media.mediaUrl, { method: 'GET' });
      const blob = await response.blob();

      const sizeInMb = blob.size / (1024 * 1024);
      if (sizeInMb > 20) {
        setDownloadNotice(`⚠️ File is ${sizeInMb.toFixed(1)}MB. In-call download is limited to 20MB max.`);
        setDownloading(false);
        setTimeout(() => setDownloadNotice(''), 4000);
        return;
      }

      // 2. Download directly to user's local disk
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = media.mediaName || `omnicall-shared-file-${Date.now()}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      // 3. Automatically save reference to user's personal Room Memories
      if (token) {
        await api.saveMemory(token, {
          roomId: roomId || null,
          roomName: roomName || 'Call Shared File',
          mediaUrl: media.mediaUrl,
          caption: `Downloaded in call: ${media.mediaName}`,
        }).catch((e) => console.warn('Memory auto-save note:', e));
      }

      setDownloadNotice('✅ Saved to your local disk & added to Room Memories!');
      setTimeout(() => setDownloadNotice(''), 4000);
    } catch (err) {
      console.error('Download file error:', err);
      // Fallback simple download
      const a = document.createElement('a');
      a.href = media.mediaUrl;
      a.download = media.mediaName || 'shared-file';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadNotice('✅ Download started');
      setTimeout(() => setDownloadNotice(''), 3000);
    } finally {
      setDownloading(false);
    }
  };

  // Show full player if: user is presenter, OR it's a live screen share, OR user explicitly clicked manual preview
  const showFullPlayer = isPresenter || isScreenshare || manualPreview;

  return (
    <div ref={containerRef} className={`presentation-stage-container ${isFullscreen ? 'fullscreen-stage' : ''}`}>
      <div className="presentation-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Monitor size={18} color="#ec4899" />
          <span>Shared File: {media.mediaName}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.8, color: '#a5b4fc', marginLeft: '8px' }}>
            (Uploaded by {media.presenterName})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {showFullPlayer && isVideo && (
            <button
              className="btn-outline"
              onClick={() => setIsLooping((prev) => !prev)}
              style={{ padding: '4px 8px', fontSize: '0.75rem', color: isLooping ? '#818cf8' : 'var(--text-muted)' }}
              title="Toggle Video Loop"
            >
              <RotateCcw size={14} /> {isLooping ? 'Looping' : 'Once'}
            </button>
          )}

          {showFullPlayer && (
            <button
              className="btn-outline"
              onClick={toggleFullscreen}
              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
              title={isFullscreen ? 'Exit Fullscreen Mode' : 'Fullscreen Presentation'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}

          {isPresenter && (
            <button className="btn-outline" onClick={onStopPresentation} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(239,68,68,0.4)' }}>
              <X size={14} /> Stop Presentation
            </button>
          )}
        </div>
      </div>

      <div className="presentation-body" style={{ background: '#090d16', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
        {showFullPlayer ? (
          isImage ? (
            <img
              ref={mediaRef}
              src={media.mediaUrl}
              alt={media.mediaName}
              className="presentation-media-img"
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
              style={{ maxHeight: isFullscreen ? '85vh' : '65vh', width: '100%', borderRadius: '8px' }}
            />
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', width: '100%' }}>
              <audio ref={mediaRef} src={media.mediaUrl} controls autoPlay loop={isLooping} style={{ width: '80%', maxWidth: '500px' }} />
              <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{media.mediaName}</p>
            </div>
          )
        ) : (
          /* Non-Presenter Download / Memory Card (Max 20MB limit enforced) */
          <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(236,72,153,0.3)', width: '100%', maxWidth: '500px' }}>
            <FileText size={36} color="#ec4899" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
              {media.mediaName}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Uploaded by <strong>{media.presenterName}</strong>. You can download this file directly to your disk and save it into your personal Room Memories (max 20MB).
            </p>

            {downloadNotice && (
              <div style={{ fontSize: '0.8rem', color: downloadNotice.startsWith('⚠️') ? '#f87171' : '#34d399', marginBottom: '12px', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                {downloadNotice}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleDownloadAndSaveToMemories}
                disabled={downloading}
                style={{ width: 'auto', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <Download size={15} /> {downloading ? 'Downloading...' : '📥 Download & Save to Memories'}
              </button>

              <button
                type="button"
                className="btn-outline"
                onClick={() => setManualPreview(true)}
                style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
              >
                <Eye size={15} /> Preview Here
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
