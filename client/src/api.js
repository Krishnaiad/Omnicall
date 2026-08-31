const BASE_URL = (import.meta.env.VITE_SERVER_URL || 'https://omnicall-api.onrender.com').replace(/\/+$/, '');


let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

async function request(endpoint, options = {}, isRetry = false) {
  const url = `${BASE_URL}${endpoint}`;
  let response = await fetch(url, options);
  let data = await response.json().catch(() => ({}));

  // If access token expired (15m elapsed), silently renew using refresh token and retry
  if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register') && !endpoint.includes('/auth/refresh')) {
    const refreshToken = localStorage.getItem('omnicall_refresh_token');
    if (refreshToken) {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          const refreshData = await refreshRes.json().catch(() => ({}));

          if (refreshRes.ok && refreshData.token) {
            localStorage.setItem('omnicall_token', refreshData.token);
            if (refreshData.refreshToken) {
              localStorage.setItem('omnicall_refresh_token', refreshData.refreshToken);
            }
            if (refreshData.user) {
              localStorage.setItem('omnicall_user', JSON.stringify(refreshData.user));
            }
            isRefreshing = false;
            onRefreshed(refreshData.token);
          } else {
            isRefreshing = false;
            localStorage.removeItem('omnicall_token');
            localStorage.removeItem('omnicall_refresh_token');
            localStorage.removeItem('omnicall_user');
            window.location.reload();
            throw new Error('Session expired. Please log in again.');
          }
        } catch (err) {
          isRefreshing = false;
          throw err;
        }
      }

      // Retry original request with newly refreshed access token
      const newToken = await new Promise((resolve) => subscribeTokenRefresh(resolve));
      const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${newToken}` };
      return request(endpoint, { ...options, headers: retryHeaders }, true);
    }
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  BASE_URL,

  refreshToken: (refreshToken) =>
    request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),


  sendOtp: (email) =>
    request('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),

  verifyOtpRegister: (email, otp, password, name, username) =>
    request('/api/auth/verify-otp-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password, name, username }),
    }),

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

  searchUsers: (token, query) =>
    request(`/api/rooms/search-users?q=${encodeURIComponent(query)}`, {
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

  inviteToRoom: (token, roomId, query) =>
    request(`/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    }),

  deleteRoom: (token, roomId) =>
    request(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  leaveRoom: (token, roomId) =>
    request(`/api/rooms/${roomId}/leave`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
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

  getRoomMessages: (token, roomId) =>
    request(`/api/rooms/${roomId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  sendRoomMessage: (token, roomId, id, text) =>
    request(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id, text }),
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

  // ─── Room State Service: Hand Raising ─────────────────────────────────────
  raiseHand: (token, roomId) =>
    request(`/api/rooms/${roomId}/raise-hand`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  lowerHand: (token, roomId, targetUserId = undefined) =>
    request(`/api/rooms/${roomId}/lower-hand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUserId }),
    }),

  getHandRaises: (token, roomId) =>
    request(`/api/rooms/${roomId}/hand-raises`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ─── Room State Service: Polls & Q&A ──────────────────────────────────────
  createPoll: (token, roomId, question, options) =>
    request(`/api/rooms/${roomId}/polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, options }),
    }),

  votePoll: (token, roomId, pollId, optionIndex) =>
    request(`/api/rooms/${roomId}/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ optionIndex }),
    }),

  closePoll: (token, roomId, pollId) =>
    request(`/api/rooms/${roomId}/polls/${pollId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  getPolls: (token, roomId) =>
    request(`/api/rooms/${roomId}/polls`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ─── Room State Service: Whiteboard ───────────────────────────────────────
  saveWhiteboardStroke: (token, roomId, stroke) =>
    request(`/api/rooms/${roomId}/whiteboard/strokes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stroke }),
    }),

  getWhiteboard: (token, roomId) =>
    request(`/api/rooms/${roomId}/whiteboard`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  clearWhiteboard: (token, roomId) =>
    request(`/api/rooms/${roomId}/whiteboard`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ─── Room State Service: Shareable Links & Guest Access ───────────────────
  getInviteLink: (token, roomId) =>
    request(`/api/rooms/${roomId}/invite-link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  getJoinPreview: (inviteToken) =>
    request(`/api/rooms/join-preview/${inviteToken}`),

  guestJoin: (inviteToken, guestName) =>
    request(`/api/rooms/guest-join/${inviteToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName }),
    }),

  endMeeting: (token, roomId) =>
    request(`/api/rooms/${roomId}/end-meeting`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  deleteAllClips: (token) =>
    request('/api/media/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ─── Room Memories & Snapshots Gallery ────────────────────────────────────
  getMemories: (token) =>
    request('/api/memories', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  saveMemory: (token, memoryData) =>
    request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(memoryData),
    }),

  deleteMemory: (token, memoryId) =>
    request(`/api/memories/${memoryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  deleteUser: (token, userId) =>
    request(`/api/auth/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
};



