import { loadDotEnv } from '../src/env.mjs';
import { initFirebaseAdmin, firebaseEnabled } from '../src/firebase-sync.mjs';
import { getAuth } from 'firebase-admin/auth';

loadDotEnv();
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Uso: npm run firebase:grant-admin -- voce@email.com');
  process.exit(2);
}
if (!firebaseEnabled()) {
  console.error('FIREBASE_ENABLED=false. Ative o Firebase no .env.');
  process.exit(2);
}
try {
  const app = initFirebaseAdmin();
  const auth = getAuth(app);
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}), openwifiAdmin: true };
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`Admin Firebase liberado ✓ ${user.email} (${user.uid})`);
  console.log('Saia e entre novamente no dashboard para renovar o token e receber a nova permissão.');
} catch (error) {
  console.error(`Não foi possível liberar o admin: ${error.message}`);
  console.error('Dica: faça login pelo menos uma vez no dashboard com essa conta Google e tente novamente.');
  process.exit(1);
}
