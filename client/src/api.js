const BASE_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  register: (email, password, name) =>
    request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  listUsers: (token) =>
    request('/api/auth/users', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  listRooms: (token) =>
    request('/api/rooms', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  createRoom: (token, name) =>
    request('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    }),

  inviteToRoom: (token, roomId, email) =>
    request(`/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email }),
    }),

  getRoomToken: (token, roomId, displayName) =>
    request(`/api/rooms/${roomId}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName }),
    }),

  listClips: (token) =>
    request('/api/media/list', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  uploadClip: (token, formData) =>
    request('/api/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }),

  deleteClip: (token, clipId) =>
    request(`/api/media/${clipId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  getStreamUrl: (token, clipId) =>
    `${BASE_URL}/api/media/stream/${clipId}?token=${encodeURIComponent(token)}`,
};
