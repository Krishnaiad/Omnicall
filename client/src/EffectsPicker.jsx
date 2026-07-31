import { useState } from 'react';
import { Sparkles, Image, X, Check } from 'lucide-react';

export const VIDEO_FILTERS = [
  { id: 'none', name: 'Normal', css: 'none' },
  { id: 'sepia', name: 'Sepia Vintage', css: 'sepia(0.8) contrast(1.1)' },
  { id: 'cyberpunk', name: 'Cyberpunk Glow', css: 'hue-rotate(280deg) saturate(2) brightness(1.1)' },
  { id: 'noir', name: 'Noir B&W', css: 'grayscale(1) contrast(1.5)' },
  { id: 'sunset', name: 'Vivid Sunset', css: 'sepia(0.4) hue-rotate(330deg) saturate(1.8)' },
  { id: 'emerald', name: 'Emerald Matrix', css: 'hue-rotate(90deg) saturate(2.5) contrast(1.3)' },
  { id: 'invert', name: 'Cosmic Invert', css: 'invert(0.9) hue-rotate(180deg)' },
  { id: 'cinematic', name: 'Teal & Orange', css: 'contrast(1.25) saturate(1.5) hue-rotate(20deg)' },
  { id: 'pastel', name: 'Soft Pastel', css: 'brightness(1.15) saturate(1.2) contrast(0.9)' },
  { id: 'contrast', name: 'High Contrast', css: 'contrast(2.2) brightness(0.9)' },
];

export const VIRTUAL_BACKGROUNDS = [
  { id: 'none', name: 'None', style: {} },
  { id: 'blur-subtle', name: 'Subtle Blur', style: { backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)' } },
  { id: 'blur-deep', name: 'Deep Privacy Blur', style: { backdropFilter: 'blur(22px)', webkitBackdropFilter: 'blur(22px)' } },
  { id: 'bg-studio', name: 'Neon Cyberpunk Studio', style: { background: 'linear-gradient(135deg, #0f172a, #1e1b4b, #311042)' } },
  { id: 'bg-office', name: 'Modern Minimalist Office', style: { background: 'linear-gradient(135deg, #1f2937, #111827)' } },
  { id: 'bg-beach', name: 'Tropical Sunset Beach', style: { background: 'linear-gradient(135deg, #f97316, #db2777, #4c1d95)' } },
  { id: 'bg-nebula', name: 'Abstract Cosmic Nebula', style: { background: 'linear-gradient(135deg, #030712, #3b0764, #1e1b4b)' } },
  { id: 'bg-coffee', name: 'Cozy Coffee Lounge', style: { background: 'linear-gradient(135deg, #451a03, #78350f, #1c1917)' } },
  { id: 'bg-grid', name: 'Geometric Cyber Grid', style: { background: 'radial-gradient(circle, #1e1b4b 0%, #090d16 100%)' } },
  { id: 'bg-garden', name: 'Lush Botanical Garden', style: { background: 'linear-gradient(135deg, #064e3b, #022c22, #0f172a)' } },
];

export default function EffectsPicker({ activeFilter, activeBg, onSelectFilter, onSelectBg, onClose }) {
  const [tab, setTab] = useState('filters');

  return (
    <div className="glass-card injector-popover" style={{ width: '380px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Sparkles size={18} color="#818cf8" /> Video Effects & Backgrounds
        </div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <div className="tab-group" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          className={`tab-btn ${tab === 'filters' ? 'active' : ''}`}
          onClick={() => setTab('filters')}
        >
          <Sparkles size={14} style={{ display: 'inline', marginRight: '4px' }} /> 10 Video Filters
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'backgrounds' ? 'active' : ''}`}
          onClick={() => setTab('backgrounds')}
        >
          <Image size={14} style={{ display: 'inline', marginRight: '4px' }} /> 10 Backgrounds
        </button>
      </div>

      {tab === 'filters' ? (
        <div className="effects-grid">
          {VIDEO_FILTERS.map((f) => {
            const selected = activeFilter === f.id;
            return (
              <button
                key={f.id}
                className={`effect-tile ${selected ? 'active' : ''}`}
                onClick={() => onSelectFilter(f.id)}
              >
                <div className="effect-preview" style={{ filter: f.css }}>
                  <span style={{ fontSize: '1.25rem' }}>📷</span>
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
            return (
              <button
                key={bg.id}
                className={`effect-tile ${selected ? 'active' : ''}`}
                onClick={() => onSelectBg(bg.id)}
              >
                <div className="effect-preview" style={bg.style}>
                  <span style={{ fontSize: '1.25rem' }}>🖼️</span>
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
