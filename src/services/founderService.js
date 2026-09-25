// Read-only founder counter for the driver onboarding screen.
//
// The backend reuses the pilot's counters/HORIZONTE_CE_BR document as the one
// shared counter. "Approved" means admin approved, not registered.

import {
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

// The first 100 approvals are counted across all service areas.
function counterRef() {
  return doc(db, 'counters', SERVICE_AREA_HORIZONTE_CE_BR);
}

// Reads the current approved-driver count for the platform.
// Returns 0 when the counter document does not exist yet.
export async function getApprovedCount() {
  const snap = await getDoc(counterRef());
  if (!snap.exists()) return 0;
  const data = snap.data();
  return data.approvedCount || 0;
}
