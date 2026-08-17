/**
 * Optional source video for an analysis. Two files in the recordings dir:
 * `<id>.video.<ext>` (a COPY of the source clip — picker URIs point into the
 * OS cache, which iOS may purge, so a bare reference would rot) and
 * `<id>.video.json` holding `{ "videoUri": "file://..." }` for the analysis
 * screen to resolve. A separate ref file — not a field in the analysis
 * sidecar — keeps the sidecar exactly the schemaVersion-1 contract that
 * `parseAnalysis` validates. Missing or unreadable ref simply means "no
 * video" and the analysis screen hides the player.
 */
import { File } from "expo-file-system";

import { recordingsDirectory } from "./recordingsDir";

function videoRefName(id: string): string {
  return `${id}.video.json`;
}

function extensionOf(uri: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(uri);
  return match ? match[1].toLowerCase() : "mp4";
}

/**
 * Copy the source clip into the recordings directory and record it as the
 * video for analysis `id`. Callers treat failure as "no video" (the analysis
 * itself must still save), so wrap in try/catch at the call site.
 */
export function adoptAnalysisVideo(id: string, sourceUri: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${id}.video.${extensionOf(sourceUri)}`);
  if (dest.exists) dest.delete();
  new File(sourceUri).copy(dest);
  writeAnalysisVideoRef(id, dest.uri);
}

export function writeAnalysisVideoRef(id: string, videoUri: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, videoRefName(id));
  if (!file.exists) file.create();
  file.write(JSON.stringify({ videoUri }));
}

export function readAnalysisVideoRef(id: string): string | null {
  try {
    const dir = recordingsDirectory();
    if (!dir.exists) return null;
    const file = new File(dir, videoRefName(id));
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(file.textSync());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { videoUri?: unknown }).videoUri !== "string"
    ) {
      return null;
    }
    const uri = (parsed as { videoUri: string }).videoUri;
    if (uri.length === 0) return null;
    // A ref whose video has since vanished (cache purge, manual delete) is
    // "no video", not a broken player.
    if (uri.startsWith("file:") && !new File(uri).exists) return null;
    return uri;
  } catch {
    return null;
  }
}

/** Remove the ref and, when it lives in the recordings dir, the copied clip. */
export function deleteAnalysisVideoRef(id: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) return;
  const ref = new File(dir, videoRefName(id));
  if (!ref.exists) return;
  try {
    const parsed: unknown = JSON.parse(ref.textSync());
    const uri = (parsed as { videoUri?: unknown } | null)?.videoUri;
    if (typeof uri === "string" && uri.startsWith(dir.uri)) {
      const video = new File(uri);
      if (video.exists) video.delete();
    }
  } catch {
    // Unreadable ref — still delete it below.
  }
  ref.delete();
}
