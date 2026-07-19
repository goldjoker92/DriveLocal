import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';

export async function requestPasswordReset(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    const error = new Error('A valid email is required.');
    error.code = 'auth/invalid-email';
    throw error;
  }

  await sendPasswordResetEmail(auth, normalizedEmail);
  return true;
}
