// ============================================================
// Écran documents chauffeur DriveLocal — Iteration 1B
// Upload via storageService (actif après dev build Android)
//
// IMPORTANT: uploadDriverDocument nécessite @react-native-firebase et un dev
// build Android. Sur web l'upload échouera — c'est prévu.
// Pour tester le flow complet sans upload : mettre documentsStatus: "submitted"
// (et chaque *Status: "submitted") manuellement dans Firestore Console.
// ============================================================

import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import {
  getDriver,
  updateDocumentUrl,
  submitForReview,
} from '../../services/driverService';
import { uploadDriverDocument } from '../../services/storageService';
import { VEHICLE_MOTO } from '../../constants/vehicleTypes';

// Mapping docType -> champ statut Firestore (pour pré-remplir l'état au montage).
const STATUS_FIELD = {
  selfie: 'selfieStatus',
  cnh_frente: 'cnhFrenteStatus',
  cnh_verso: 'cnhVersoStatus',
  crlv: 'crlvStatus',
  vehicle_photo: 'vehiclePhotoStatus',
  motofrete_cert: 'motofreteStatus',
};

// Construit la liste des documents requis selon le type de véhicule.
function buildDocList(vehicleType) {
  const base = [
    { type: 'selfie', label: 'Selfie', selfie: true, note: 'Foto do rosto (câmera frontal).' },
    { type: 'cnh_frente', label: 'CNH frente', note: null },
    { type: 'cnh_verso', label: 'CNH verso', note: null },
    { type: 'crlv', label: 'CRLV', note: 'Documento do veículo.' },
    { type: 'vehicle_photo', label: 'Foto do veículo', note: 'Foto do veículo com a placa visível.' },
  ];
  if (vehicleType === VEHICLE_MOTO) {
    base.push({
      type: 'motofrete_cert',
      label: 'Certificado Motofretista',
      note: 'Certificado de Condutor de Mototáxi (obrigatório por lei).',
    });
  }
  return base;
}

export default function Documents() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState(null);
  const [docState, setDocState] = useState({}); // { [docType]: { status, progress, error, url } }
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const uid = auth.currentUser && auth.currentUser.uid;

  // Charge le driver, son type de véhicule et les statuts existants.
  useEffect(() => {
    let active = true;
    if (!uid) {
      setLoading(false);
      return;
    }
    getDriver(uid)
      .then((d) => {
        if (!active || !d) return;
        console.log('[DOCUMENTS] loaded driver docs status from Firestore');
        setVehicleType(d.vehicleType || null);
        // Pré-affiche "done" pour les documents déjà soumis.
        const initial = {};
        Object.keys(STATUS_FIELD).forEach((docType) => {
          if (d[STATUS_FIELD[docType]] === 'submitted') {
            initial[docType] = { status: 'done', progress: 100 };
          }
        });
        setDocState(initial);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [uid]);

  // Met à jour l'état d'un document (merge).
  function patchDoc(docType, patch) {
    setDocState((prev) => ({ ...prev, [docType]: { ...prev[docType], ...patch } }));
  }

  // Sélection via caméra (front pour la selfie).
  async function pickFromCamera(front) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Permissão de câmera negada.');
    return ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });
  }

  // Sélection via galerie.
  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Permissão de galeria negada.');
    return ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
  }

  // Lance la sélection puis l'upload pour un document.
  async function startUpload(docType, source) {
    try {
      console.log(`[DOCUMENTS] picking ${docType} source: ${source}`);
      const result = source === 'camera' ? await pickFromCamera(docType === 'selfie') : await pickFromGallery();
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      await doUpload(docType, result.assets[0]);
    } catch (e) {
      console.log(`[DOCUMENTS] upload error docType=${docType} error=${e.message}`);
      patchDoc(docType, { status: 'error', error: e.message });
    }
  }

  // Upload effectif + enregistrement de l'URL.
  async function doUpload(docType, asset) {
    console.log(`[DOCUMENTS] upload start docType=${docType}`);
    patchDoc(docType, { status: 'uploading', progress: 0, error: '' });
    try {
      const { url } = await uploadDriverDocument({
        driverId: uid,
        docType,
        uri: asset.uri,
        mime: asset.mimeType,
        onProgress: (pct) => {
          console.log(`[DOCUMENTS] upload progress ${pct}%`);
          patchDoc(docType, { status: 'uploading', progress: pct });
        },
      });
      await updateDocumentUrl(uid, docType, url);
      console.log(`[DOCUMENTS] upload success docType=${docType}`);
      patchDoc(docType, { status: 'done', progress: 100, url });
    } catch (e) {
      console.log(`[DOCUMENTS] upload error docType=${docType} error=${e.message}`);
      patchDoc(docType, { status: 'error', error: e.message });
    }
  }

  // Selfie : caméra frontale obligatoire. Autres : choix Câmera/Galeria.
  function onPressUpload(docItem) {
    if (docItem.selfie) {
      console.log('[DOCUMENTS] launching front camera for selfie');
      startUpload('selfie', 'camera');
      return;
    }
    Alert.alert('Como deseja enviar?', undefined, [
      { text: 'Câmera', onPress: () => startUpload(docItem.type, 'camera') },
      { text: 'Galeria', onPress: () => startUpload(docItem.type, 'gallery') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  const docList = buildDocList(vehicleType);

  // allSubmitted dérivé de l'état local (un doc "done" == "submitted").
  const required = docList.map((d) => d.type);
  const allSubmitted = required.every((t) => docState[t] && docState[t].status === 'done');

  // Soumet le cadastro pour analyse.
  async function handleSubmit() {
    if (!uid) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      // Marque les documents comme soumis (pour la redirection par statut).
      await updateDoc(doc(db, 'drivers', uid), {
        documentsStatus: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Contrôle de doublons + passage à pending_review.
      await submitForReview(uid);
      console.log('[DOCUMENTS] submitForReview called -> pending_review');
      router.replace('/(driver)/verification-status');
    } catch (e) {
      console.log('[DOCUMENTS] submit error', e.message);
      setSubmitError('Não foi possível enviar para análise. Tente novamente.');
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Documentos" subtitle="Etapa 3 de 3 — envie para verificação" onBack={() => router.back()} />

        {loading ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando...</Text>
          </AppCard>
        ) : (
          <>
            {docList.map((docItem) => {
              const st = docState[docItem.type] || { status: 'idle' };
              return (
                <AppCard key={docItem.type}>
                  <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{docItem.label}</Text>
                  {docItem.note ? (
                    <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{docItem.note}</Text>
                  ) : null}

                  {/* État visuel par document */}
                  {st.status === 'idle' ? (
                    <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>⬜ Não enviado</Text>
                  ) : null}
                  {st.status === 'uploading' ? (
                    <View style={{ gap: spacing.xs }}>
                      <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
                        ⏳ Enviando... {st.progress || 0}%
                      </Text>
                      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.border }}>
                        <View
                          style={{
                            height: 6,
                            borderRadius: radius.pill,
                            backgroundColor: colors.primary,
                            width: `${st.progress || 0}%`,
                          }}
                        />
                      </View>
                    </View>
                  ) : null}
                  {st.status === 'done' ? (
                    <Text style={[{ fontFamily, color: colors.success }, typography.small]}>✅ Enviado</Text>
                  ) : null}
                  {st.status === 'error' ? (
                    <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
                      ❌ Erro no envio{st.error ? ` — ${st.error}` : ''}
                    </Text>
                  ) : null}

                  {/* Bouton selon l'état */}
                  {st.status === 'uploading' ? (
                    <AppButton title="Enviando..." disabled onPress={() => {}} />
                  ) : st.status === 'done' ? (
                    <AppButton title="Reenviar" variant="secondary" onPress={() => onPressUpload(docItem)} />
                  ) : st.status === 'error' ? (
                    <AppButton title="Tentar novamente" onPress={() => onPressUpload(docItem)} />
                  ) : (
                    <AppButton title="Enviar" onPress={() => onPressUpload(docItem)} />
                  )}
                </AppCard>
              );
            })}

            {submitError ? (
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{submitError}</Text>
            ) : null}

            {/* Visible/actif seulement quand tous les documents obligatoires sont ✅ */}
            <AppButton
              title={submitting ? 'Enviando...' : 'Enviar para análise'}
              onPress={handleSubmit}
              disabled={!allSubmitted || submitting}
            />
            {!allSubmitted ? (
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                Envie todos os documentos obrigatórios para liberar o envio.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
