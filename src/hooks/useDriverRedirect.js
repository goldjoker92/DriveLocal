// ============================================================
// Hook DriveLocal — Redirection chauffeur selon statut Firestore
// Utilisé dans email-login et partout où on doit router un driver
// ============================================================

import { useRouter } from 'expo-router';

// Retourne une fonction redirect(driver) qui envoie le chauffeur vers le bon
// écran selon l'avancement de son cadastro (statuts persistants Firestore).
export function useDriverRedirect() {
  const router = useRouter();

  // Décide la route en fonction des statuts du document driver.
  // L'ordre est important : on complète le profil, puis le véhicule, puis les
  // documents, avant d'arriver au suivi de vérification.
  return function redirect(driver) {
    const d = driver || {};

    // 1. Profil incomplet -> formulaire de profil.
    if (d.profileStatus === 'incomplete') {
      console.log('[REDIRECT] driver status profileStatus=incomplete -> /(driver)/profile');
      router.replace('/(driver)/profile');
      return;
    }

    // 2. Véhicule incomplet -> formulaire véhicule.
    if (d.vehicleStatus === 'incomplete') {
      console.log('[REDIRECT] driver status vehicleStatus=incomplete -> /(driver)/vehicle');
      router.replace('/(driver)/vehicle');
      return;
    }

    // 3. Documents manquants/incomplets -> écran documents.
    if (d.documentsStatus === 'missing' || d.documentsStatus === 'incomplete') {
      console.log('[REDIRECT] driver status documentsStatus=' + d.documentsStatus + ' -> /(driver)/documents');
      router.replace('/(driver)/documents');
      return;
    }

    // 4. En attente de revue -> suivi de vérification.
    if (d.verificationStatus === 'pending_review') {
      console.log('[REDIRECT] driver status pending_review -> /(driver)/verification-status');
      router.replace('/(driver)/verification-status');
      return;
    }

    // 5. Approuvé -> tableau de bord chauffeur.
    if (d.verificationStatus === 'approved') {
      console.log('[REDIRECT] driver status approved -> /(driver)/driver-home');
      router.replace('/(driver)/driver-home');
      return;
    }

    // 6. Refusé -> suivi de vérification (affiche le motif).
    if (d.verificationStatus === 'rejected') {
      console.log('[REDIRECT] driver status rejected -> /(driver)/verification-status');
      router.replace('/(driver)/verification-status');
      return;
    }

    // 6bis. Correction demandée par l'admin -> suivi de vérification
    // (affiche le motif + bouton pour renvoyer les documents).
    if (d.verificationStatus === 'correction_requested') {
      console.log('[REDIRECT] driver status correction_requested -> /(driver)/verification-status');
      router.replace('/(driver)/verification-status');
      return;
    }

    // 6ter. Suspendu -> suivi de vérification (écran de statut bloqué).
    if (d.verificationStatus === 'suspended') {
      console.log('[REDIRECT] driver status suspended -> /(driver)/verification-status');
      router.replace('/(driver)/verification-status');
      return;
    }

    // 7. Défaut -> onboarding.
    console.log('[REDIRECT] driver status default -> /(driver)/onboarding');
    router.replace('/(driver)/onboarding');
  };
}
