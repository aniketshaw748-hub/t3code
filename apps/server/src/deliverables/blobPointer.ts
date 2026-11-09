import { deliverableKindForPath } from "@t3tools/contracts";

// Git LFS pointer format (https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md), so a
// version commit reads the same way to `git lfs` tooling pointed at the blob store.
const POINTER_VERSION = "version https://git-lfs.github.com/spec/v1";
const POINTER_PATTERN =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n$/;
/** Pointer files are small; anything larger is real content. */
export const MAX_POINTER_BYTES = 200;

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "m4a", "flac", "ogg"]);
/** Files past this size go to the blob store even when their kind is not media. */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

export interface BlobPointer {
  readonly oid: string;
  readonly size: number;
}

export const encodeBlobPointer = (pointer: BlobPointer): string =>
  `${POINTER_VERSION}\noid sha256:${pointer.oid}\nsize ${pointer.size}\n`;

export function parseBlobPointer(text: string): BlobPointer | null {
  const match = POINTER_PATTERN.exec(text);
  if (match === null) return null;
  return { oid: match[1]!, size: Number(match[2]) };
}

/** Whether a version commit keeps this file as a pointer to the blob store. */
export function storesAsPointer(path: string, sizeBytes: number): boolean {
  if (sizeBytes >= LARGE_FILE_BYTES) return true;
  if (deliverableKindForPath(path) !== "other") return true;
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") && AUDIO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}
