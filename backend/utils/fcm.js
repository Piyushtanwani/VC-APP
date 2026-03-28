const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require(path.join(__dirname, '..', 'fcm-service-account.json'));
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('🚀 Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Error initializing Firebase Admin:', error.message);
  console.warn('⚠️  Push notifications will be disabled.');
}

/**
 * Send a push notification to a specific user token
 * @param {string} token - FCM registration token
 * @param {object} payload - Notification payload { title, body, data }
 */
async function sendPushNotification(token, payload, channelId = 'default') {
  if (!admin.apps.length) return false;
  if (!token) return false;

  const isVoip = channelId === 'calls';

  const message = {
    // For VoIP on Android, we use DATA-ONLY messages (no 'notification' block)
    // to trigger the app's background listener and show a full-screen calling UI.
    ...(isVoip ? {} : {
      notification: {
        title: payload.title,
        body: payload.body,
      }
    }),
    android: {
      priority: 'high',
      ttl: 0, // Deliver immediately
      notification: isVoip ? undefined : {
        channelId: channelId,
        sound: 'default',
        priority: 'high',
        visibility: 'public'
      }
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: 'default',
          badge: 1,
          'content-available': 1 // Wake up app in background
        }
      },
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert'
      }
    },
    data: payload.data || {},
    token: token
  };

  // Add more call-specific data for VoIP
  if (isVoip) {
    message.data.isVoip = 'true';
    message.data.title = payload.title;
    message.data.body = payload.body;
  }

  try {
    const response = await admin.messaging().send(message);
    console.log(`✅ ${isVoip ? 'VoIP' : 'Push'} notification sent:`, response);
    return true;
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    return false;
  }
}

module.exports = { sendPushNotification };
