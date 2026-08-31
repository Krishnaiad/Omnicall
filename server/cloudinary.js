import { v2 as cloudinary } from 'cloudinary';
import { storageConfig } from './config.js';

if (storageConfig.provider === 'cloudinary') {
  cloudinary.config({
    cloud_name: storageConfig.cloudName,
    api_key: storageConfig.apiKey,
    api_secret: storageConfig.apiSecret,
    secure: true,
  });
}

export async function healthCheck() {
  if (storageConfig.provider !== 'cloudinary') return { ok: true, provider: storageConfig.provider };
  try {
    const res = await cloudinary.api.ping();
    return { ok: res.status === 'ok', provider: 'cloudinary' };
  } catch (err) {
    return { ok: false, provider: 'cloudinary', error: err.message };
  }
}

export async function uploadMedia(filePath, { isVideo, isAudio, publicId } = {}) {
  const resourceType = isVideo || isAudio ? 'video' : 'image';
  const res = await cloudinary.uploader.upload(filePath, {
    resource_type: resourceType,
    public_id: publicId,
    folder: 'omnicall',
    overwrite: true,
  });
  return {
    publicId: res.public_id,
    secureUrl: res.secure_url,
    duration: res.duration || 0,
    bytes: res.bytes || 0,
    format: res.format,
  };
}

export async function deleteMedia(publicId, { isVideo, isAudio } = {}) {
  const resourceType = isVideo || isAudio ? 'video' : 'image';
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

export { cloudinary };
