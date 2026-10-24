import { Readable } from 'node:stream';
import { gridfsBucket } from '../db.js';
import { badRequest } from '../errors.js';

const ALLOWED = {
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG',
};

// Trust the file's content, not the extension or the declared mime type.
export function detectMime(buffer) {
  for (const [mime, check] of Object.entries(ALLOWED)) if (check(buffer)) return mime;
  throw badRequest('Only PDF, JPEG and PNG files are accepted');
}

export function saveToGridFs(buffer, { filename, mime, metadata }) {
  return new Promise((resolve, reject) => {
    const upload = gridfsBucket().openUploadStream(filename, { contentType: mime, metadata });
    Readable.from(buffer).pipe(upload).on('error', reject).on('finish', () => resolve(upload.id));
  });
}

export const openGridFsStream = (id) => gridfsBucket().openDownloadStream(id);
