const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor;
const API_BASE = isCapacitor ? 'http://192.168.1.5:3001' : (import.meta.env.DEV ? '' : '');

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const { headers: customHeaders, ...restOptions } = options;
  const config = {
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...customHeaders
    }
  };

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, config);
  } catch (networkErr) {
    throw new Error('Network error: Cannot reach server at ' + API_BASE);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

export const api = {
  // Auth
  register: (username, email, password) =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) }),

  login: (username, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  getMe: () => apiFetch('/auth/me'),

  // Users
  searchUsers: (query) => apiFetch(`/users?search=${encodeURIComponent(query)}`),

  // Friend Requests
  sendFriendRequest: (receiverId) =>
    apiFetch('/friend-request/send', { method: 'POST', body: JSON.stringify({ receiverId }) }),

  respondFriendRequest: (requestId, action) =>
    apiFetch('/friend-request/respond', { method: 'POST', body: JSON.stringify({ requestId, action }) }),

  getFriendRequests: () => apiFetch('/friend-request'),

  getSentRequests: () => apiFetch('/friend-request/sent'),

  // Friends
  getFriends: () => apiFetch('/friends'),

  // Messages
  getMessages: (friendId) => apiFetch(`/messages/${friendId}`),
  getCallHistory: () => apiFetch('/calls'),
};
