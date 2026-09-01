import 'dotenv/config';

// Resolved ONCE at process start. Never re-read process.env per request.
function resolveStorageConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    return {
      provider: 'cloudinary',
      cloudName,
      apiKey,
      apiSecret,
    };
  }

  // Warn if only partially set (e.g., cloud name set but keys missing)
  if (cloudName || apiKey || apiSecret) {
    const missing = [
      !cloudName && 'CLOUDINARY_CLOUD_NAME',
      !apiKey && 'CLOUDINARY_API_KEY',
      !apiSecret && 'CLOUDINARY_API_SECRET',
    ].filter(Boolean).join(', ');
    throw new Error(`Incomplete Cloudinary configuration. Missing env vars: ${missing}`);
  }


  const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  const r2Present = r2Keys.filter((k) => !!process.env[k]);

  if (r2Present.length === r2Keys.length) {
    return {
      provider: 'r2',
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET_NAME,
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    };
  }

  if (r2Present.length > 0 && r2Present.length < r2Keys.length) {
    const missing = r2Keys.filter((k) => !r2Present.includes(k)).join(', ');
    throw new Error(`Incomplete Cloudflare R2 configuration. Missing: ${missing}`);
  }

  return { provider: 'local' };
}

export const storageConfig = resolveStorageConfig();
