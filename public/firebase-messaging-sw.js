importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDBoPIbHabZnjdScsTyFi3osVyPp88KuSM",
  authDomain: "pantrypal-6e410.firebaseapp.com",
  projectId: "pantrypal-6e410",
  storageBucket: "pantrypal-6e410.firebasestorage.app",
  messagingSenderId: "592127259891",
  appId: "1:592127259891:web:fcc158b7b1c35ce0b3b386"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon-192.png'
  });
});
