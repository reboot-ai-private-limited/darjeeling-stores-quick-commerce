import { api, ApiError } from "./http";

type Ticket = { mediaId: string; upload: { url: string; method?: string; fields?: Record<string, string> } };
export type MediaKind = "address_photo" | "address_voice" | "refund_photo";

/** Uploads one file straight to storage with a signed ticket, then tells the server it finished. Returns the media id to attach to an address or refund. */
async function upload(kind: MediaKind, uri: string, contentType: string, fileName: string, extra: { durationSec?: number; ownerRef?: { type: string; id: string } } = {}): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const { data: ticket } = await api<Ticket>("POST", "/media/upload-url", { kind, contentType, sizeBytes: blob.size, ...extra });
  const form = new FormData();
  Object.entries(ticket.upload.fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", blob as unknown as Blob, fileName);
  const put = await fetch(ticket.upload.url, { method: ticket.upload.method ?? "POST", body: form });
  if (!put.ok) throw new ApiError("The file could not be uploaded. Check your connection and try again.", put.status, "UPLOAD_FAILED");
  await api("POST", "/media/complete", { mediaId: ticket.mediaId });
  return ticket.mediaId;
}

export const uploadPhoto = (kind: "address_photo" | "refund_photo", uri: string, ownerRef?: { type: string; id: string }) =>
  upload(kind, uri, "image/jpeg", "photo.jpg", ownerRef ? { ownerRef } : {});
export const uploadVoice = (uri: string, durationSec: number) => upload("address_voice", uri, "audio/mp4", "voice.m4a", { durationSec });

/** A short-lived link to a private file the customer owns. */
export const getMediaUrl = (mediaId: string) => api<{ url: string }>("GET", `/media/${mediaId}/url`).then(r => r.data.url);

/** Friendly text for upload errors. */
export const uploadMessage = (e: unknown): string => {
  if (e instanceof ApiError) {
    const r = e.details?.reason;
    if (e.code === "UPLOAD_REJECTED") return r === "too_large" ? "That file is too big." : r === "too_long" ? "The voice note is too long (10 seconds at most)." : r === "too_many_pending" ? "Too many uploads in progress. Try again shortly." : "That file can't be used.";
    if (e.code === "SERVICE_UNAVAILABLE") return "File upload isn't available right now. You can add it later.";
  }
  return e instanceof Error ? e.message : "Upload failed.";
};
