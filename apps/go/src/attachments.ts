// Karya Go — screenshots, photos and files on a ticket. Same three-step upload as the full app:
// ask the API for a signed upload, send the file to storage, tell the API it arrived.
// SPDX-License-Identifier: AGPL-3.0-only

export type Attachment = {
  id: string;
  file: File;
  preview: string; // object URL for images, "" otherwise
  status: "ready" | "uploading" | "done" | "failed";
  progress: number; // 0..1
  error?: string;
};

export const ACCEPT = "image/*,video/*,application/pdf,.csv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.txt,.json,.heic,.heif";
export const MAX_FILES = 10;
const SHRINKABLE = /^image\/(jpeg|png|webp|bmp)$/;

let counter = 0;
export function toAttachment(file: File): Attachment {
  return {
    id: `a${Date.now()}-${counter++}`,
    file,
    preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    status: "ready",
    progress: 0,
  };
}
export const release = (items: Attachment[]) => items.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));

/** Phone photos are often 6-12 MB; Karya takes 5 MB. Re-encode big images as JPEG, longest side 2560 px. */
export async function fitToLimit(file: File, limit: number): Promise<File> {
  if (file.size <= limit) return file;
  if (!SHRINKABLE.test(file.type)) throw new Error(`${file.name} is over ${Math.round(limit / 1048576)} MB.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.86, 0.72, 0.6]) {
    // oxlint-disable-next-line no-await-in-loop -- try qualities in order, stop at the first that fits
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= limit)
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  throw new Error(`${file.name} is too large even after shrinking.`);
}

type Signed = { asset_id: string; upload_data: { url: string; fields: Record<string, string> } };

async function api<T>(method: string, url: string, body?: object): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Upload refused (${response.status}).`);
  return data as T;
}

function send(url: string, form: FormData, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => e.lengthComputable && onProgress(e.loaded / e.total));
    xhr.addEventListener("load", () => {
      if (xhr.status < 300) resolve();
      else reject(new Error("Storage refused the file."));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload interrupted. Check your connection.")));
    xhr.send(form);
  });
}

export async function upload(
  slug: string,
  projectId: string,
  issueId: string,
  file: File,
  limit: number,
  onProgress: (p: number) => void
) {
  const ready = await fitToLimit(file, limit);
  const base = `/api/assets/v2/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/`;
  // The server works out the type from the name when the phone gives none (karya/files.py).
  const signed = await api<Signed>("POST", base, { name: ready.name, size: ready.size, type: ready.type });
  const form = new FormData();
  Object.entries(signed.upload_data.fields).forEach(([key, value]) => form.append(key, value));
  form.append("file", ready);
  await send(signed.upload_data.url, form, onProgress);
  await api("PATCH", `${base}${signed.asset_id}/`);
}

/** Files shared into Karya Go from the gallery (Android share sheet), parked by the service worker. */
export async function takeShared(): Promise<{ files: File[]; text: string }> {
  if (!("caches" in window)) return { files: [], text: "" };
  const cache = await caches.open("karya-go-share");
  const entries = await Promise.all(
    (await cache.keys()).map(async (request) => {
      const response = await cache.match(request);
      await cache.delete(request);
      if (!response) return null;
      if (request.url.endsWith("/text")) return { text: await response.text() };
      const name = decodeURIComponent(response.headers.get("X-File-Name") || "shared");
      const blob = await response.blob();
      return { file: new File([blob], name, { type: blob.type }), order: request.url };
    })
  );
  const files = entries
    .filter((e): e is { file: File; order: string } => !!e && "file" in e)
    .toSorted((a, b) => a.order.localeCompare(b.order, undefined, { numeric: true }))
    .map((e) => e.file);
  const text = entries.find((e): e is { text: string } => !!e && "text" in e)?.text ?? "";
  return { files, text };
}
