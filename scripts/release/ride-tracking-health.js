#!/usr/bin/env node
// @ts-check
// NON-MUTATING live-location report (lecture seule).
//
// Répond à une question : sur les courses acceptées, le passager a-t-il vu le
// chauffeur bouger ? Lit rideRequests + rideTrackingHealth (écrit par
// functions/src/rides/liveLocationGuard.js). N'écrit jamais rien.
//
// Usage :
//   node scripts/release/ride-tracking-health.js --project drivelocal-prod
//   node scripts/release/ride-tracking-health.js --project drivelocal-prod --hours 72
//
// Requires application default credentials with Firestore read access:
//   gcloud auth application-default login

const path = require('path');
function requireAdminSdk() {
  try {
    return require('firebase-admin');
  } catch (_rootError) {
    try {
      return require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
    } catch (_functionsError) {
      console.error('firebase-admin not found. Install backend dependencies first:\n  cd functions && npm install');
      process.exit(1);
    }
  }
}

const admin = requireAdminSdk();
const C = require('../../functions/src/rides/constants');

const OFFSET_MS = -3 * 3_600_000; // Horizonte (UTC-3, sans heure d'été)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const clock = (ms) => (ms > 0 ? new Date(ms + OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') : '—');
const secs = (ms) => (Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms / 1000)} s` : '—');
const pct = (part, total) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');

const STATE_LABEL = {
  healthy: 'OK — le passager voyait le chauffeur',
  relayed: 'RELAYÉ — carte mise à jour par le serveur (canal course du chauffeur coupé)',
  stale: 'FIGÉ — aucune position fraîche',
};

async function main() {
  const projectId = arg('project', null);
  if (!projectId) {
    console.error('Usage : node scripts/release/ride-tracking-health.js --project drivelocal-prod [--hours 24]');
    process.exit(1);
  }
  const hours = Number(arg('hours', '24'));
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const snap = await db.collection(C.RIDE_REQUESTS)
    .where('createdAtMs', '>=', Date.now() - hours * 3_600_000).get();
  const rides = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((r) => Number(r.acceptedAtMs || 0) > 0)
    .sort((a, b) => Number(b.acceptedAtMs) - Number(a.acceptedAtMs));

  console.log(`\nSUIVI DE POSITION — ${projectId} — dernières ${hours} h\n`);
  if (rides.length === 0) { console.log('  Aucune course acceptée sur la période.\n'); return; }

  const healthDocs = await Promise.all(rides.map((r) => db.collection(C.RIDE_TRACKING_HEALTH).doc(r.id).get()));
  const totals = { watched: 0, incident: 0, relayed: 0, stale: 0, cancelledAfterIncident: 0 };

  rides.forEach((r, i) => {
    const h = healthDocs[i].exists ? healthDocs[i].data() || {} : null;
    const hadIncident = Number(h?.incidentNumber || 0) > 0;
    if (h) totals.watched += 1;
    if (hadIncident) totals.incident += 1;
    if (Number(h?.mirroredPoints || 0) > 0) totals.relayed += 1;
    if (Number(h?.staleChecks || 0) > 0) totals.stale += 1;
    if (hadIncident && r.status === C.RIDE_STATUS.CANCELLED) totals.cancelledAfterIncident += 1;

    const vehicle = r.vehicleType === 'moto' ? 'Moto' : 'Carro';
    const outcome = r.status === C.RIDE_STATUS.CANCELLED
      ? `annulée (${r.cancelledBy || 'inconnu'} · ${r.cancelReasonCode || 'sans raison'})`
      : r.status;
    console.log(`  ${i + 1}. ${clock(Number(r.acceptedAtMs))}  ·  ${vehicle}  ·  ${outcome}`);
    if (!h) {
      console.log('     Suivi        : non surveillée (course antérieure au déploiement du garde)');
    } else {
      const worst = Number(h.staleChecks || 0) > 0 ? 'stale' : Number(h.mirroredPoints || 0) > 0 ? 'relayed' : 'healthy';
      console.log(`     Suivi        : ${STATE_LABEL[worst]}`);
      if (hadIncident) {
        console.log(`     Incidents    : ${h.incidentNumber} · pire écart ${secs(Number(h.maxGapMs))} · phase ${h.incidentRideStatus || '—'} · build ${h.driverBuildNumber || '?'}`);
        console.log(`     Alertes      : chauffeur ${Number(h.driverAlertCount || 0)} · passager ${h.passengerNoticeAtMs ? 'oui' : 'non'}`);
      }
      if (Number(h.mirroredPoints || 0) > 0) console.log(`     Relais       : ${h.mirroredPoints} position(s) relayée(s) par le serveur`);
    }
    console.log(`     ID course    : ${r.id}\n`);
  });

  console.log(`  ${rides.length} course(s) acceptée(s) · surveillées ${totals.watched}`);
  console.log(`  Avec incident : ${totals.incident} (${pct(totals.incident, totals.watched)}) · relayées ${totals.relayed} · figées ${totals.stale}`);
  console.log(`  Annulées après un incident : ${totals.cancelledAfterIncident}`);
  // Décide du minimum exigé avec des faits : quel build produit encore des incidents ?
  const byBuild = {};
  healthDocs.forEach((doc) => {
    const h = doc.exists ? doc.data() || {} : null;
    if (!h) return;
    const key = h.driverBuildNumber || '?';
    byBuild[key] = byBuild[key] || { rides: 0, incidents: 0 };
    byBuild[key].rides += 1;
    if (Number(h.incidentNumber || 0) > 0) byBuild[key].incidents += 1;
  });
  const lines = Object.entries(byBuild).map(([build, v]) => `build ${build} : ${v.incidents}/${v.rides}`);
  if (lines.length > 0) console.log(`  Incidents par build : ${lines.join(' · ')}`);
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
