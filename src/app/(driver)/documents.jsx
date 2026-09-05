// Driver document package. The profile photo uses a dedicated camera-only flow:
// guided capture -> passenger preview -> private admin review. Other documents keep
// their existing camera/gallery upload behavior.

import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { DRIVER_PHOTO_STATUS, driverPhotoStatus, rejectionReasonLabel } from '../../constants/driverPhoto';
import { auth, db } from '../../config/firebase';
import {
  getDriver,
  submitForReview,
  updateCriminalCertificate,
  updateDocumentUrl,
} from '../../services/driverService';
import {
  uploadDriverCriminalCertificate,
  uploadDriverDocument,
} from '../../services/storageService';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';
import {
  CRIMINAL_CERTIFICATE_ACCEPTED_MIME_TYPES,
  CRIMINAL_CERTIFICATE_ISSUER_URL,
  requiresCriminalCertificate,
} from '../../utils/driverDocumentPolicy';

const STATUS_FIELD = {
  cnh_frente: 'cnhFrenteStatus',
  cnh_verso: 'cnhVersoStatus',
  crlv: 'crlvStatus',
  vehicle_photo: 'vehiclePhotoStatus',
  criminal_certificate: 'criminalCertificateStatus',
};

function buildDocList(driver) {
  const documents = [
    {
      type: 'selfie',
      label: 'Foto de motorista',
      profilePhoto: true,
      note: 'Selfie guiado que o passageiro verá somente após aprovação.',
    },
    { type: 'cnh_frente', label: 'CNH frente', note: null },
    { type: 'cnh_verso', label: 'CNH verso', note: null },
    { type: 'crlv', label: 'CRLV', note: 'Documento do veículo.' },
    { type: 'vehicle_photo', label: 'Foto do veículo', note: 'Foto do veículo com a placa visível.' },
  ];
  if (requiresCriminalCertificate(driver)) {
    documents.push({
      type: 'criminal_certificate',
      label: 'Certidão de antecedentes criminais',
      note: 'Emita gratuitamente no portal oficial e envie em PDF, JPG, PNG ou WebP.',
      criminalCertificate: true,
    });
  }
  return documents;
}

function PhotoStatus({ state, driver }) {
  if (state.status === 'done' && state.photoReviewStatus === DRIVER_PHOTO_STATUS.APPROVED) {
    return <Text style={styles.success}>✅ Foto aprovada</Text>;
  }
  if (state.status === 'done' && state.photoReviewStatus === DRIVER_PHOTO_STATUS.PENDING) {
    return <Text style={styles.pending}>⏳ Foto enviada — aguardando análise</Text>;
  }
  if (state.status === 'error') {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={styles.error}>❌ Foto não aprovada</Text>
        <Text style={styles.muted}>
          {driver?.driverPhotoRejectionReason || rejectionReasonLabel(driver?.driverPhotoRejectionCode)}
        </Text>
      </View>
    );
  }
  return <Text style={styles.muted}>⬜ Não enviada</Text>;
}

export default function Documents() {
  const router = useRouter();
  const uid = auth.currentUser?.uid;
  const [driver, setDriver] = useState(null);
  const [docState, setDocState] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setSubmitError('');
      if (!uid) {
        setLoading(false);
        return undefined;
      }

      getDriver(uid)
        .then((data) => {
          if (!active || !data) return;
          setDriver(data);
          const initial = {};
          const photoStatus = driverPhotoStatus(data);
          if (photoStatus === DRIVER_PHOTO_STATUS.APPROVED || photoStatus === DRIVER_PHOTO_STATUS.PENDING) {
            initial.selfie = { status: 'done', progress: 100, photoReviewStatus: photoStatus };
          } else if (photoStatus === DRIVER_PHOTO_STATUS.REJECTED) {
            initial.selfie = { status: 'error', progress: 0, photoReviewStatus: photoStatus };
          }
          Object.entries(STATUS_FIELD).forEach(([docType, field]) => {
            if (data[field] === 'submitted' || data[field] === 'approved') {
              initial[docType] = { status: 'done', progress: 100 };
            }
          });
          setDocState(initial);
          logDriverPhotoEvent('documents.photo_status_loaded', {
            driverId: uid,
            status: photoStatus,
            hasApprovedPhoto: photoStatus === DRIVER_PHOTO_STATUS.APPROVED,
          });
        })
        .catch((error) => {
          console.log('[DOCUMENTS] load error', error?.message || 'unknown');
          if (active) setSubmitError('Não foi possível carregar os documentos.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
      };
    }, [uid])
  );

  function patchDoc(docType, patch) {
    setDocState((previous) => ({
      ...previous,
      [docType]: { ...previous[docType], ...patch },
    }));
  }

  async function pickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Permissão de câmera negada.');
    return ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
    });
  }

  async function pickFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error('Permissão de galeria negada.');
    return ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
  }

  async function pickFromFiles() {
    return DocumentPicker.getDocumentAsync({
      type: CRIMINAL_CERTIFICATE_ACCEPTED_MIME_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
  }

  async function startUpload(docType, source) {
    try {
      console.log(`[DOCUMENTS] picking ${docType} source=${source}`);
      const result = source === 'camera'
        ? await pickFromCamera()
        : source === 'gallery'
          ? await pickFromGallery()
          : await pickFromFiles();
      if (result.canceled || !result.assets?.[0]) return;
      await doUpload(docType, result.assets[0]);
    } catch (error) {
      console.log(`[DOCUMENTS] upload error docType=${docType}`, error?.message || 'unknown');
      patchDoc(docType, { status: 'error', error: error?.message });
    }
  }

  async function doUpload(docType, asset) {
    patchDoc(docType, { status: 'uploading', progress: 0, error: '' });
    try {
      if (docType === 'criminal_certificate') {
        const file = await uploadDriverCriminalCertificate({
          driverId: uid,
          uri: asset.uri,
          mime: asset.mimeType,
          fileName: asset.name || asset.fileName,
          onProgress: (progress) => patchDoc(docType, { status: 'uploading', progress }),
        });
        await updateCriminalCertificate(uid, file);
        patchDoc(docType, { status: 'done', progress: 100 });
      } else {
        const { url } = await uploadDriverDocument({
          driverId: uid,
          docType,
          uri: asset.uri,
          mime: asset.mimeType,
          onProgress: (progress) => patchDoc(docType, { status: 'uploading', progress }),
        });
        await updateDocumentUrl(uid, docType, url);
        patchDoc(docType, { status: 'done', progress: 100, url });
      }
    } catch (error) {
      console.log(`[DOCUMENTS] upload failed docType=${docType}`, error?.message || 'unknown');
      patchDoc(docType, { status: 'error', error: error?.message });
    }
  }

  function onPressUpload(item) {
    if (item.profilePhoto) {
      logDriverPhotoEvent('documents.open_guided_capture', {
        driverId: uid,
        status: driverPhotoStatus(driver),
        action: 'initial_or_replace',
      });
      router.push({ pathname: '/(driver)/driver-photo', params: { returnTo: 'documents' } });
      return;
    }
    if (item.criminalCertificate) {
      Alert.alert('Como deseja enviar?', undefined, [
        { text: 'Arquivo PDF ou imagem', onPress: () => startUpload(item.type, 'file') },
        { text: 'Câmera', onPress: () => startUpload(item.type, 'camera') },
        { text: 'Galeria', onPress: () => startUpload(item.type, 'gallery') },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('Como deseja enviar?', undefined, [
      { text: 'Câmera', onPress: () => startUpload(item.type, 'camera') },
      { text: 'Galeria', onPress: () => startUpload(item.type, 'gallery') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  async function openCriminalCertificateIssuer() {
    try {
      console.log('[CRIMINAL_CERTIFICATE] issuer.open_requested');
      await Linking.openURL(CRIMINAL_CERTIFICATE_ISSUER_URL);
      console.log('[CRIMINAL_CERTIFICATE] issuer.open_succeeded');
    } catch (error) {
      console.log('[CRIMINAL_CERTIFICATE] issuer.open_failed', {
        code: error?.code || error?.name || 'unknown',
      });
      setSubmitError('Não foi possível abrir o portal oficial. Tente novamente.');
    }
  }

  const docList = buildDocList(driver);
  const allSubmitted = docList.every((item) => docState[item.type]?.status === 'done');

  async function handleSubmit() {
    if (!uid || submitting) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'drivers', uid), {
        documentsStatus: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await submitForReview(uid);
      console.log('[DOCUMENTS] package submitted -> pending_review');
      router.replace('/(driver)/verification-status');
    } catch (error) {
      console.log('[DOCUMENTS] submit error', error?.message || 'unknown');
      setSubmitError('Não foi possível enviar para análise. Verifique os documentos e tente novamente.');
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Documentos" subtitle="Etapa 3 de 3 — envie para verificação" onBack={() => router.back()} />

        {loading ? (
          <AppCard><Text style={styles.muted}>Carregando…</Text></AppCard>
        ) : (
          <>
            {docList.map((item) => {
              const state = docState[item.type] || { status: 'idle' };
              return (
                <AppCard key={item.type}>
                  <Text style={styles.title}>{item.label}</Text>
                  {item.note ? <Text style={styles.muted}>{item.note}</Text> : null}

                  {item.criminalCertificate ? (
                    <AppButton
                      title="Emitir gratuitamente no portal oficial"
                      variant="secondary"
                      onPress={openCriminalCertificateIssuer}
                      disabled={state.status === 'uploading'}
                    />
                  ) : null}

                  {item.profilePhoto ? (
                    <PhotoStatus state={state} driver={driver} />
                  ) : (
                    <>
                      {state.status === 'idle' ? <Text style={styles.muted}>⬜ Não enviado</Text> : null}
                      {state.status === 'uploading' ? (
                        <View style={{ gap: spacing.xs }}>
                          <Text style={styles.pending}>⏳ Enviando… {state.progress || 0}%</Text>
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${state.progress || 0}%` }]} />
                          </View>
                        </View>
                      ) : null}
                      {state.status === 'done' ? <Text style={styles.success}>✅ Enviado</Text> : null}
                      {state.status === 'error' ? (
                        <Text style={styles.error}>❌ Erro no envio{state.error ? ` — ${state.error}` : ''}</Text>
                      ) : null}
                    </>
                  )}

                  {state.status === 'uploading' ? (
                    <AppButton title="Enviando…" disabled />
                  ) : state.status === 'done' ? (
                    <AppButton
                      title={item.profilePhoto ? 'Ver ou substituir foto' : 'Reenviar'}
                      variant="secondary"
                      onPress={() => onPressUpload(item)}
                    />
                  ) : state.status === 'error' ? (
                    <AppButton title="Corrigir" onPress={() => onPressUpload(item)} />
                  ) : (
                    <AppButton title={item.profilePhoto ? 'Tirar selfie guiado' : 'Enviar'} onPress={() => onPressUpload(item)} />
                  )}
                </AppCard>
              );
            })}

            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
            <AppButton
              title={submitting ? 'Enviando…' : 'Enviar para análise'}
              onPress={handleSubmit}
              disabled={!allSubmitted || submitting}
            />
            {!allSubmitted ? (
              <Text style={styles.muted}>Envie todos os documentos obrigatórios para liberar o envio.</Text>
            ) : (
              <Text style={styles.muted}>
                A foto pode estar em análise. O cadastro só será aprovado depois que a foto pública também for aprovada.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  title: { fontFamily, color: colors.text, ...typography.bodyBold },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  success: { fontFamily, color: colors.success, ...typography.small, fontWeight: '700' },
  pending: { fontFamily, color: colors.warning, ...typography.small, fontWeight: '700' },
  error: { fontFamily, color: colors.danger, ...typography.small },
  progressTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
});
