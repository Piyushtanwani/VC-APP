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

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: channelId,
        sound: 'default'
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
          priority: 10
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

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent successfully:', response);
    return true;
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    return false;
  }
}

module.exports = { sendPushNotification };
