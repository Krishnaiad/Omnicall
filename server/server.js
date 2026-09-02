import app from './index.js';
import { storageConfig } from './config.js';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`[Server] OmniCall WebRTC platform running on port ${PORT}`);
  console.log(`[Server] Storage Provider locked at boot: ${storageConfig.provider.toUpperCase()}`);
  console.log(`[Server] Auth rate limit: 10 failed attempts / 15min per IP`);
});
