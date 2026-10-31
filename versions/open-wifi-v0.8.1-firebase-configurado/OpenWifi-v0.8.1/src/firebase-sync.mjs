import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function cleanSiteId(value) {
  const id = String(value || 'openwifi-main').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return id || 'openwifi-main';
}

function docId(value, fallback = 'unknown') {
  const raw = String(value || fallback).trim();
  return raw.replaceAll('/', '_').slice(0, 400) || fallback;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function serviceAccountCredential() {
  const configured = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (!configured) return applicationDefault();
  const filename = path.resolve(configured);
  if (!fs.existsSync(filename)) throw new Error(`Arquivo da conta de serviço Firebase não encontrado: ${filename}`);
  const json = JSON.parse(fs.readFileSync(filename, 'utf8'));
  return cert(json);
}

function firebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() || undefined;
}

export function firebaseEnabled() {
  return envBool('FIREBASE_ENABLED', false);
}

export function initFirebaseAdmin() {
  if (!firebaseEnabled()) return null;
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: serviceAccountCredential(),
    projectId: firebaseProjectId()
  });
}

export class FirebaseSyncService {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.app = null;
    this.db = null;
    this.timer = null;
    this.running = false;
    this.lastHashes = new Map();
    this.lastError = null;
    this.lastSyncAt = null;
  }

  isEnabled() { return firebaseEnabled(); }
  siteId() { return cleanSiteId(process.env.FIREBASE_SITE_ID); }
  siteName() { return process.env.FIREBASE_SITE_NAME?.trim() || 'Open Wi-Fi'; }
  syncMs() {
    const n = Number(process.env.FIREBASE_SYNC_MS || 10000);
    return Number.isFinite(n) ? Math.max(5000, n) : 10000;
  }

  async start() {
    if (!this.isEnabled()) return { enabled: false };
    this.app = initFirebaseAdmin();
    this.db = getFirestore(this.app);
    await this.syncNow();
    this.timer = setInterval(() => this.syncNow().catch(error => {
      this.lastError = error.message;
      console.error('[firebase/sync]', error.message);
    }), this.syncMs());
    this.timer.unref?.();
    return { enabled: true, siteId: this.siteId(), syncMs: this.syncMs() };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      enabled: this.isEnabled(),
      siteId: this.siteId(),
      siteName: this.siteName(),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    };
  }

  async syncNow() {
    if (!this.isEnabled() || this.running) return;
    this.running = true;
    try {
      if (!this.db) {
        this.app = initFirebaseAdmin();
        this.db = getFirestore(this.app);
      }
      const snapshot = await this.dashboard.snapshot();
      const siteRef = this.db.collection('openwifi_sites').doc(this.siteId());
      const syncedAt = Date.now();

      const siteData = {
        siteId: this.siteId(),
        name: this.siteName(),
        version: '0.8.0',
        generatedAt: snapshot.generatedAt,
        timezone: snapshot.timezone,
        router: snapshot.router,
        metrics: snapshot.metrics,
        agent: {
          online: true,
          hostname: process.env.HOSTNAME || process.env.COMPUTERNAME || 'openwifi-agent',
          paymentsMode: process.env.PAYMENTS_MODE || 'mock',
          mikrotikMode: process.env.MIKROTIK_MODE || 'mock'
        },
        syncedAt,
        serverSyncedAt: FieldValue.serverTimestamp()
      };
      await siteRef.set(siteData, { merge: true });

      const seenClients = new Set();
      const clientWrites = [];
      for (const client of snapshot.clients || []) {
        const id = docId(client.mac, 'unknown-client');
        seenClients.add(id);
        const payload = {
          ...client,
          siteId: this.siteId(),
          updatedAt: syncedAt
        };
        const comparable = { ...payload };
        delete comparable.updatedAt;
        const hash = stableHash(comparable);
        const key = `client:${id}`;
        if (this.lastHashes.get(key) === hash) continue;
        this.lastHashes.set(key, hash);
        clientWrites.push(siteRef.collection('clients').doc(id).set(payload, { merge: true }));
      }
      await Promise.all(clientWrites);

      // Purchases are append/update data. Once unchanged, they stop generating Firestore writes.
      const purchaseWrites = [];
      for (const purchase of snapshot.purchases || []) {
        const id = docId(purchase.id, purchase.orderId || 'purchase');
        const payload = { ...purchase, siteId: this.siteId() };
        const hash = stableHash(payload);
        const key = `purchase:${id}`;
        if (this.lastHashes.get(key) === hash) continue;
        this.lastHashes.set(key, hash);
        purchaseWrites.push(siteRef.collection('purchases').doc(id).set(payload, { merge: true }));
      }
      await Promise.all(purchaseWrites);

      this.lastSyncAt = syncedAt;
      this.lastError = null;
      return { ok: true, siteId: this.siteId(), clientsWritten: clientWrites.length, purchasesWritten: purchaseWrites.length, syncedAt };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = false;
    }
  }
}
