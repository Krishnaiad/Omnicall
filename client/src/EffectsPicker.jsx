import { useState } from 'react';
import { Sparkles, Image as ImageIcon, X, Check } from 'lucide-react';

export const VIDEO_FILTERS = [
  { id: 'none', name: 'Normal', css: 'none', emoji: '✨' },
  { id: 'cinematic', name: 'Teal & Orange', css: 'contrast(1.3) saturate(1.6) hue-rotate(15deg)', emoji: '🎬' },
  { id: 'cyberpunk', name: 'Cyberpunk Glow', css: 'hue-rotate(280deg) saturate(2.2) brightness(1.15) contrast(1.2)', emoji: '🌆' },
  { id: 'synthwave', name: '80s Synthwave', css: 'sepia(0.3) hue-rotate(300deg) saturate(2.4) contrast(1.2)', emoji: '📼' },
  { id: 'noir', name: 'Vintage Noir B&W', css: 'grayscale(1) contrast(1.6) brightness(0.9)', emoji: '🎩' },
  { id: 'sunset', name: 'Golden Sunset', css: 'sepia(0.45) hue-rotate(335deg) saturate(2) contrast(1.1)', emoji: '🌅' },
  { id: 'pastel', name: 'Pastel Anime', css: 'brightness(1.2) saturate(1.3) contrast(0.85)', emoji: '🌸' },
  { id: 'matrix', name: 'Matrix Terminal (Funny)', css: 'hue-rotate(95deg) saturate(3.5) contrast(1.4) brightness(0.95)', emoji: '👽' },
  { id: 'ghost', name: 'Ghost Invert (Funny)', css: 'invert(1) hue-rotate(180deg) contrast(1.5)', emoji: '👻' },
  { id: 'disco', name: 'Disco Rainbow (Funny)', css: 'hue-rotate(180deg) saturate(3) contrast(1.3) brightness(1.2)', emoji: '🪩' },
  { id: 'thermal', name: 'Thermal Heatmap (Funny)', css: 'invert(0.8) hue-rotate(240deg) saturate(3) contrast(1.5)', emoji: '🔥' },
  { id: 'contrast', name: 'Dramatic Film', css: 'contrast(2.2) brightness(0.9) saturate(1.2)', emoji: '📽️' },
];

export const VIRTUAL_BACKGROUNDS = [
  { id: 'none', name: 'None', type: 'none', emoji: '🚫' },
  { id: 'blur-subtle', name: 'Subtle Blur', type: 'blur', style: { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }, emoji: '🌫️' },
  { id: 'blur-deep', name: 'Deep Privacy Blur', type: 'blur', style: { backdropFilter: 'blur(25px)', WebkitBackdropFilter: 'blur(25px)' }, emoji: '🔒' },
  {
    id: 'bg-penthouse',
    name: 'Luxury Penthouse',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1502005229762-ea1b4a3a6fa6?w=1200&auto=format&fit=crop&q=80',
    emoji: '🏙️',
  },
  {
    id: 'bg-tokyo',
    name: 'Tokyo Neon City',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=1200&auto=format&fit=crop&q=80',
    emoji: '🏮',
  },
  {
    id: 'bg-beach',
    name: 'Tropical Bali Beach',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80',
    emoji: '🏖️',
  },
  {
    id: 'bg-coffee',
    name: 'Cozy Library Lounge',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=1200&auto=format&fit=crop&q=80',
    emoji: '☕',
  },
  {
    id: 'bg-space',
    name: 'NASA Space Orbit (Funny)',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80',
    emoji: '🚀',
  },
  {
    id: 'bg-office',
    name: 'Minimalist Modern Office',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&auto=format&fit=crop&q=80',
    emoji: '🏢',
  },
  {
    id: 'bg-garden',
    name: 'Lush Botanical Garden',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=1200&auto=format&fit=crop&q=80',
    emoji: '🌿',
  },
  {
    id: 'bg-minecraft',
    name: 'Pixel World (Funny)',
    type: 'image',
    imgUrl: 'https://images.unsplash.com/photo-1627856014754-2907e2355d54?w=1200&auto=format&fit=crop&q=80',
    emoji: '👾',
  },
];

// ─── Device Tier Detection (Point 5 Fix) ────────────────────────────────────
// Detects if the current device has enough resources for high-complexity CSS
// filter operations on live video. Low-tier devices skip blur-deep to prevent
// frame drops when CSS GPU processing combines with WebRTC decoding.
function getDeviceTier() {
  const memory = navigator.deviceMemory || 4; // GB — Chrome/Edge only, defaults to 4 if unsupported
  const cores = navigator.hardwareConcurrency || 4;
  if (memory <= 2 || cores <= 2) return 'low';
  if (memory <= 4 || cores <= 4) return 'medium';
  return 'high';
}

const DEVICE_TIER = getDeviceTier();

// Backgrounds that require significant GPU compositing — disabled on low-tier devices
const HIGH_PERF_BG_IDS = new Set(['blur-deep']);

const TIER_LABELS = {
  low: { label: '⚡ Low-Power Device', color: '#f87171', tip: 'Deep blur disabled to prevent frame drops on your device.' },
  medium: { label: '⚙️ Standard Device', color: '#fbbf24', tip: 'All effects enabled. Some complex filters may cause minor frame drops.' },
  high: { label: '💪 High-Performance Device', color: '#34d399', tip: 'All effects and backgrounds are fully available.' },
};
// ─────────────────────────────────────────────────────────────────────────────

export default function EffectsPicker({ activeFilter, activeBg, onSelectFilter, onSelectBg, onClose }) {
  const [tab, setTab] = useState('filters');
  const tierInfo = TIER_LABELS[DEVICE_TIER];

  return (
    <div className="glass-card injector-popover" style={{ width: '400px', maxWidth: '92vw' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
          <Sparkles size={18} color="var(--accent)" /> Video effects & backgrounds
        </div>
        <button onClick={onClose} className="btn-ghost" style={{ padding: '4px' }}>
          <X size={16} />
        </button>
      </div>

      {/* Device Tier Badge */}
      <div
        title={tierInfo.tip}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '0.7rem', fontWeight: 500, color: tierInfo.color,
          background: `${tierInfo.color}18`, borderRadius: '6px',
          padding: '4px 8px', marginBottom: '12px', cursor: 'help',
        }}
      >
        {tierInfo.label}
        {DEVICE_TIER === 'low' && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— Deep Blur disabled to maintain call quality</span>}
      </div>

      <div className="tab-group" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          className={`tab-btn ${tab === 'filters' ? 'active' : ''}`}
          onClick={() => setTab('filters')}
        >
          <Sparkles size={14} style={{ display: 'inline', marginRight: '4px' }} /> 12 Video filters
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'backgrounds' ? 'active' : ''}`}
          onClick={() => setTab('backgrounds')}
        >
          <ImageIcon size={14} style={{ display: 'inline', marginRight: '4px' }} /> 11 Backgrounds
        </button>
      </div>

      {tab === 'filters' ? (
        <div className="effects-grid">
          {VIDEO_FILTERS.map((f) => {
            const selected = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                className={`effect-tile ${selected ? 'active' : ''}`}
                onClick={() => onSelectFilter(selected ? 'none' : f.id)}
              >
                <div className="effect-preview" style={{ filter: f.css }}>
                  <span style={{ fontSize: '1.4rem' }}>{f.emoji}</span>
                </div>
                <div className="effect-name">
                  {f.name} {selected && <Check size={12} color="#818cf8" />}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="effects-grid">
          {VIRTUAL_BACKGROUNDS.map((bg) => {
            const selected = activeBg === bg.id;
            const isDisabledOnDevice = DEVICE_TIER === 'low' && HIGH_PERF_BG_IDS.has(bg.id);

            return (
              <button
                key={bg.id}
                type="button"
                className={`effect-tile ${selected ? 'active' : ''} ${isDisabledOnDevice ? 'effect-tile-disabled' : ''}`}
                onClick={() => !isDisabledOnDevice && onSelectBg(selected ? 'none' : bg.id)}
                title={isDisabledOnDevice ? 'Disabled: your device may not handle deep blur during a live call without frame drops' : bg.name}
                style={{ opacity: isDisabledOnDevice ? 0.45 : 1, cursor: isDisabledOnDevice ? 'not-allowed' : 'pointer' }}
              >
                <div
                  className="effect-preview"
                  style={
                    bg.imgUrl
                      ? {
                          backgroundImage: `url(${bg.imgUrl})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : bg.style || {}
                  }
                >
                  <span style={{ fontSize: '1.4rem', textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>{bg.emoji}</span>
                  {isDisabledOnDevice && (
                    <span style={{ position: 'absolute', bottom: '2px', right: '2px', fontSize: '0.55rem', background: 'rgba(0,0,0,0.8)', color: '#f87171', borderRadius: '4px', padding: '1px 4px' }}>
                      Low-power
                    </span>
                  )}
                </div>
                <div className="effect-name">
                  {bg.name} {selected && <Check size={12} color="#ec4899" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

