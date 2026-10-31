import { loadDotEnv } from '../src/env.mjs';
import { initFirebaseAdmin, firebaseEnabled } from '../src/firebase-sync.mjs';
import { getFirestore } from 'firebase-admin/firestore';

loadDotEnv();
if (!firebaseEnabled()) {
  console.error('FIREBASE_ENABLED=false. Ative no .env antes do teste.');
  process.exit(2);
}
try {
  const app = initFirebaseAdmin();
  const db = getFirestore(app);
  const siteId = process.env.FIREBASE_SITE_ID || 'openwifi-main';
  await db.collection('openwifi_sites').doc(siteId).set({ connectivityTestAt: Date.now() }, { merge: true });
  console.log(`Firebase conectado ✓ projeto=${app.options.projectId || '(automático)'} site=${siteId}`);
} catch (error) {
  console.error(`Firebase NÃO conectou ✗ ${error.message}`);
  process.exit(1);
}
