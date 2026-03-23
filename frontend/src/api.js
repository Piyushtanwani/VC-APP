import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();
const API_BASE = 'https://vc-app-ibdu.onrender.com';

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
  register: (username, email, password, otpCode) =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, otpCode }) }),

  sendOtp: (email, purpose, username) =>
    apiFetch('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email, purpose, username }) }),

  forgotPassword: (email) =>
    apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (email, otpCode, newPassword) =>
    apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, otpCode, newPassword }) }),

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
  updateFcmToken: (fcmToken) =>
    apiFetch('/auth/fcm-token', { method: 'POST', body: JSON.stringify({ fcmToken }) }),
};
