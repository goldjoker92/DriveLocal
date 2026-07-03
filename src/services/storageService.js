import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { storage } from "../config/firebase";

const NS = "[STORAGE]";
const MAX_WIDTH = 1200;
const COMPRESS_QUALITY = 0.7;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const DRIVER_DOCS = Object.freeze({
  selfie: "selfie",
  cnh_frente: "cnh_frente",
  cnh_verso: "cnh_verso",
  crlv: "crlv",
  vehicle_photo: "vehicle_photo",
  motofrete_cert: "motofrete_cert",
});

export { DRIVER_DOCS };

export async function compressImage(uri) {
  console.log(NS, "compressing image...");

  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_WIDTH, height: null });

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: COMPRESS_QUALITY,
  });

  try {
    const info = await FileSystem.getInfoAsync(result.uri);
    if (info && info.size) {
      console.log(NS, "compressed size KB:", Math.round(info.size / 1024));
    }
  } catch (e) {
    console.log(NS, "compressed size unknown:", e.message);
  }

  return result.uri;
}

export function uriToBlob_XHR(uri) {
  console.log(NS, "uri -> blob via XHR");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.onload = () => {
      resolve(xhr.response);
    };

    xhr.onerror = () => {
      reject(new Error("uriToBlob_XHR failed"));
    };

    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

export async function uploadDriverDocument({ driverId, docType, uri, mime, onProgress }) {
  if (!driverId) throw new Error("uploadDriverDocument: driverId manquant");
  if (!DRIVER_DOCS[docType]) throw new Error(`uploadDriverDocument: docType inválido (${docType})`);
  if (!uri) throw new Error("uploadDriverDocument: uri manquant");

  if (Platform.OS === "web") {
    throw new Error("Upload indisponível na web — use o dev build Android.");
  }

  console.log(NS, `uploadDriverDocument start docType=${docType} driverId=${driverId}`);

  const contentType = mime || "image/jpeg";
  const path = `drivers/${driverId}/${docType}.jpg`;

  const compressedUri = await compressImage(uri);

  try {
    const info = await FileSystem.getInfoAsync(compressedUri);
    if (info && info.size && info.size > MAX_SIZE_BYTES) {
      throw new Error("Arquivo muito grande (máx. 5 MB).");
    }
  } catch (e) {
    if (String(e.message || "").includes("Arquivo muito grande")) {
      throw e;
    }
    console.log(NS, "size check skipped:", e.message);
  }

  const blob = await uriToBlob_XHR(compressedUri);
  const storageRef = ref(storage, path);

  const metadata = { contentType };

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, metadata);

    task.on(
      "state_changed",
      (snapshot) => {
        const pct = snapshot.totalBytes
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;

        console.log(NS, `progress ${pct}% docType=${docType}`);
        if (typeof onProgress === "function") onProgress(pct);
      },
      (error) => {
        reject(error);
      },
      () => {
        resolve();
      }
    );
  });

  if (blob && typeof blob.close === "function") {
    blob.close();
  }

  const url = await getDownloadURL(storageRef);
  console.log(NS, `uploadDriverDocument success url=${url}`);

  return { url, path, contentType };
}
