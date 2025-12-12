importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// Initialize Firebase
firebase.initializeApp({
  apiKey: "AIzaSyDBoPIbHabZnjdScsTyFi3osVyPp88KuSM",
  authDomain: "pantrypal-6e410.firebaseapp.com",
  projectId: "pantrypal-6e410",
  storageBucket: "pantrypal-6e410.firebasestorage.app",
  messagingSenderId: "592127259891",
  appId: "1:592127259891:web:fcc158b7b1c35ce0b3b386"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const notificationTitle = payload.notification?.title || 'PantryPal Alert';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new notification',
    icon: '/icon-192.png',           // Uses your local icon from public folder
    badge: '/icon-192.png',
    image: payload.notification?.image || undefined,
    tag: payload.notification?.tag || 'pantrypal-notification',
    requireInteraction: true,         // Keeps notification visible until dismissed
    actions: [
      {
        action: 'open',
        title: 'Open PantryPal',
        icon: '/icon-192.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icon-192.png'
      }
    ],
    data: {
      url: 'https://pantrypal-zdi4.onrender.com/'  // Opens your app when clicked
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click received.');

  event.notification.close();

  if (event.action === 'open' || !event.action) {
    // Open the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        // If app is already open, focus it
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});
