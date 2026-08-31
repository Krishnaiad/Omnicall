import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from './config.js';

// Single reused client — never instantiate per request.
export const client = storageConfig.provider === 'r2'
  ? new S3Client({
      region: 'auto',
      endpoint: storageConfig.endpoint,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    })
  : null;

const MULTIPART_THRESHOLD = 8 * 1024 * 1024; // 8MB
const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 408]);

async function withRetry(fn, { attempts = 4, baseDelayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.$metadata?.httpStatusCode;
      const retryable = RETRYABLE_STATUS.has(status) || err.name === 'TimeoutError';
      if (!retryable || i === attempts - 1) throw err;
      const jitter = Math.random() * 100;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i + jitter));
    }
  }
  throw lastErr;
}

export async function healthCheck() {
  if (storageConfig.provider !== 'r2') return { ok: true, provider: 'local' };
  try {
    await withRetry(() => client.send(new HeadBucketCommand({ Bucket: storageConfig.bucket })), { attempts: 2 });
    return { ok: true, provider: 'r2' };
  } catch (err) {
    return { ok: false, provider: 'r2', error: err.message };
  }
}

export async function uploadStream(key, readableStream, { contentType, sizeHint } = {}) {
  if (!client) throw new Error('R2 Client is not configured');
  if (sizeHint && sizeHint > MULTIPART_THRESHOLD) {
    return uploadMultipart(key, readableStream, { contentType });
  }
  return withRetry(() => client.send(new PutObjectCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    Body: readableStream,
    ContentType: contentType,
  })));
}

export async function uploadMultipart(key, readableStream, { contentType, partSizeBytes = 8 * 1024 * 1024 }) {
  if (!client) throw new Error('R2 Client is not configured');
  const { UploadId } = await withRetry(() => client.send(new CreateMultipartUploadCommand({
    Bucket: storageConfig.bucket, Key: key, ContentType: contentType,
  })));
  const parts = [];
  let partNumber = 1;
  let buffer = Buffer.alloc(0);

  try {
    for await (const chunk of readableStream) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= partSizeBytes) {
        const part = buffer.subarray(0, partSizeBytes);
        buffer = buffer.subarray(partSizeBytes);
        const res = await withRetry(() => client.send(new UploadPartCommand({
          Bucket: storageConfig.bucket, Key: key, UploadId, PartNumber: partNumber, Body: part,
        })));
        parts.push({ ETag: res.ETag, PartNumber: partNumber });
        partNumber++;
      }
    }
    if (buffer.length > 0) {
      const res = await withRetry(() => client.send(new UploadPartCommand({
        Bucket: storageConfig.bucket, Key: key, UploadId, PartNumber: partNumber, Body: buffer,
      })));
      parts.push({ ETag: res.ETag, PartNumber: partNumber });
    }
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: storageConfig.bucket, Key: key, UploadId, MultipartUpload: { Parts: parts },
    }));
  } catch (err) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: storageConfig.bucket, Key: key, UploadId,
    })).catch(() => {});
    throw err;
  }
}

export async function getPresignedGetUrl(key, expiresInSeconds = 600) {
  if (!client) throw new Error('R2 Client is not configured');
  return getSignedUrl(client, new GetObjectCommand({ Bucket: storageConfig.bucket, Key: key }), { expiresIn: expiresInSeconds });
}

export async function deleteObject(key) {
  if (!client) throw new Error('R2 Client is not configured');
  return withRetry(() => client.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: key })));
}

export async function listAllObjects() {
  if (!client) return [];
  const keys = [];
  let isTruncated = true;
  let continuationToken = undefined;

  while (isTruncated) {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: storageConfig.bucket,
      ContinuationToken: continuationToken,
    }));
    if (res.Contents) {
      res.Contents.forEach((item) => keys.push(item.Key));
    }
    isTruncated = res.IsTruncated;
    continuationToken = res.NextContinuationToken;
  }
  return keys;
}
