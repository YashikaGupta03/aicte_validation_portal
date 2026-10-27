const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'aicte-validation-token';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = 'GET', body, file, ...options } = {}) {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let requestBody = body;
  if (file) {
    requestBody = new FormData();
    requestBody.append('file', file);
  } else if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    method,
    headers,
    body: requestBody,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setToken(null);
    throw new ApiError(payload.error || payload.message || payload.detail || `Request failed (${response.status})`, response.status, payload.details);
  }
  return payload;
}

// Fetches a binary (e.g. an uploaded PDF/image) with the auth header. Returns a Blob.
export async function apiBlob(path) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) throw new ApiError(`Could not load file (${response.status})`, response.status);
  return response.blob();
}
