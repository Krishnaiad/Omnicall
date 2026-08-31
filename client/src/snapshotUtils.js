/**
 * Captures a high-quality memory screenshot of the active video call room grid.
 * Draws participant video frames, labels, room title, and timestamp onto a canvas.
 */
export async function captureRoomSnapshot(roomName) {
  const videoTiles = document.querySelectorAll('.video-tile');
  if (!videoTiles || videoTiles.length === 0) {
    alert('No active video tiles found to capture.');
    return;
  }

  const cols = Math.ceil(Math.sqrt(videoTiles.length));
  const rows = Math.ceil(videoTiles.length / cols);
  
  const tileWidth = 640;
  const tileHeight = 360;
  const headerHeight = 80;
  const padding = 16;

  const canvas = document.createElement('canvas');
  canvas.width = cols * (tileWidth + padding) + padding;
  canvas.height = headerHeight + rows * (tileHeight + padding) + padding;

  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header Banner
  ctx.fillStyle = '#121a2b';
  ctx.fillRect(0, 0, canvas.width, headerHeight);

  // Header Title
  ctx.font = 'bold 24px Inter, sans-serif';
  ctx.fillStyle = '#818cf8';
  ctx.fillText(`OmniCall • Room: ${roomName}`, padding, 46);

  // Timestamp Watermark
  const timeStr = new Date().toLocaleString();
  ctx.font = '500 14px Inter, sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  ctx.fillText(`Snapshot Memory • ${timeStr}`, canvas.width - padding, 46);
  ctx.textAlign = 'left';

  // Render Video Tiles
  let index = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (index >= videoTiles.length) break;

      const tileEl = videoTiles[index];
      const videoEl = tileEl.querySelector('video');
      const labelEl = tileEl.querySelector('.tile-overlay');
      const nameText = labelEl ? labelEl.innerText : `Participant ${index + 1}`;

      const x = padding + c * (tileWidth + padding);
      const y = headerHeight + padding + r * (tileHeight + padding);

      // Tile Background
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.roundRect(x, y, tileWidth, tileHeight, 12);
      ctx.fill();

      // Draw Video Frame if playing
      if (videoEl && videoEl.readyState >= 2) {
        try {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, tileWidth, tileHeight, 12);
          ctx.clip();
          ctx.drawImage(videoEl, x, y, tileWidth, tileHeight);
          ctx.restore();
        } catch (e) {
          console.warn('Frame render skipped:', e);
        }
      }

      // Draw Participant Name Label Badge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      const labelWidth = ctx.measureText(nameText).width + 24;
      const labelHeight = 32;
      const labelX = x + 16;
      const labelY = y + tileHeight - labelHeight - 16;

      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 6);
      ctx.fill();

      ctx.font = '600 14px Inter, sans-serif';
      ctx.fillStyle = '#f3f4f6';
      ctx.fillText(nameText, labelX + 12, labelY + 21);

      index++;
    }
  }

  // Trigger PNG File Download
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `OmniCall-Snapshot-${roomName.replace(/\s+/g, '_')}-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return dataUrl;
}

