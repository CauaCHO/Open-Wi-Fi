// Configuração pública do app Web Firebase do Open Wi-Fi.
// Este objeto identifica o projeto; a autorização real é feita por Firebase Auth + Firestore Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyBp_pnkZpXIsn0R6RhkM36u9Ut91IZ6BLk",
  authDomain: "open-wi-fi.firebaseapp.com",
  projectId: "open-wi-fi",
  storageBucket: "open-wi-fi.firebasestorage.app",
  messagingSenderId: "752353609825",
  appId: "1:752353609825:web:ce1aa663de32e9173e8220",
  measurementId: "G-35KLP1ZS7J"
};

// ID lógico deste ponto Open Wi-Fi dentro do Firestore.
// Deve ser igual a FIREBASE_SITE_ID no .env do agente local.
export const OPENWIFI_SITE_ID = "openwifi-main";
