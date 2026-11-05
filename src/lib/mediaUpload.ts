import { auth } from "./firebase";
import { API_BASE_URL, ApiError } from "./apiClient";
import type { MediaKind, MediaVariant } from "../../shared/media";

export interface UploadedMedia {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

const UPLOAD_TIMEOUT_MS = 120000;

export async function uploadMedia(
  kind: MediaKind,
  variant: MediaVariant,
  blob: Blob,
  onProgress?: (fraction: number) => void
): Promise<UploadedMedia> {
  const user = auth.currentUser;
  if (!user) throw new ApiError("AUTH_REQUIRED", "AUTH_REQUIRED", 401);
  const idToken = await user.getIdToken();

  return new Promise<UploadedMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/media/upload?kind=${kind}&variant=${variant}`);
    xhr.setRequestHeader("Authorization", `Bearer ${idToken}`);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.timeout = UPLOAD_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError("NETWORK_ERROR", "Network error while uploading", 0));
    xhr.ontimeout = () => reject(new ApiError("NETWORK_TIMEOUT", "The upload took too long", 0));
    xhr.onabort = () => reject(new ApiError("UPLOAD_ABORTED", "The upload was cancelled", 0));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const result = (body as { result?: UploadedMedia } | null)?.result;
        if (result && typeof result.url === "string") {
          resolve(result);
        } else {
          reject(new ApiError("INTERNAL", "Unexpected upload response", xhr.status));
        }
        return;
      }
      const failure = (body as { error?: { code?: string; message?: string } } | null)?.error;
      reject(new ApiError(failure?.code ?? "INTERNAL", failure?.message ?? "Upload failed", xhr.status));
    };

    xhr.send(blob);
  });
}
