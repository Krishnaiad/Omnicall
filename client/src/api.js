const BASE_URL = import.meta.env.VITE_SERVER_URL || '';

async function request(endpoint, options = {}) {
  const { token, body, isFormData, ...customConfig } = options;

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    method: body ? 'POST' : 'GET',
    ...customConfig,
    headers: {
      ...headers,
      ...customConfig.headers,
    },
  };

  if (body) {
    config.body = isFormData ? body : JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'An unexpected API error occurred');
  }

  return data;
}

export const api = {
  // Auth
  register: (email, password, name) => request('/api/auth/register', { body: { email, password, name } }),
  login: (email, password) => request('/api/auth/login', { body: { email, password } }),

  // Rooms
  listRooms: (token) => request('/api/rooms', { token }),
  createRoom: (token, name) => request('/api/rooms', { token, body: { name } }),
  inviteToRoom: (token, roomId, email) => request(`/api/rooms/${roomId}/invite`, { token, body: { email } }),
  getRoomToken: (token, roomId, displayName) =>
    request(`/api/rooms/${roomId}/token`, { token, method: 'POST', body: { displayName } }),

  // Media
  uploadClip: (token, formData) => request('/api/media/upload', { token, body: formData, isFormData: true }),
  listClips: (token) => request('/api/media/list', { token }),
  deleteClip: (token, id) => request(`/api/media/${id}`, { token, method: 'DELETE' }),
  getStreamUrl: (token, id) => `${BASE_URL}/api/media/stream/${id}?token=${token}`,
};
