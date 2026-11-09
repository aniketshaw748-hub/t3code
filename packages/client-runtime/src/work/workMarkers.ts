import type { DeliverableNote, DeliverableNoteId, DeliverableNoteStatus } from "@t3tools/contracts";

import { mostUrgentStatus } from "./workNotes.ts";

export interface NoteMarker {
  /** 0..1 along the progress rail. */
  readonly position: number;
  /** Seconds the marker seeks to: its earliest note. */
  readonly time: number;
  readonly noteIds: ReadonlyArray<DeliverableNoteId>;
  readonly status: DeliverableNoteStatus;
}

/**
 * Dots under the progress rail for notes pinned to a time. Notes closer than `minGap` (a
 * fraction of the rail) share one dot coloured by the most urgent of them, so dots never
 * overlap at any rail width the caller measures for.
 */
export function layoutNoteMarkers(
  notes: ReadonlyArray<Pick<DeliverableNote, "id" | "anchor" | "status">>,
  durationSeconds: number | null,
  minGap: number,
): ReadonlyArray<NoteMarker> {
  if (durationSeconds === null || !(durationSeconds > 0)) return [];
  const timed = notes
    .flatMap((note) =>
      note.anchor?.kind === "time"
        ? [{ note, t: Math.min(Math.max(note.anchor.t, 0), durationSeconds) }]
        : [],
    )
    .sort((a, b) => a.t - b.t);
  const markers: Array<{
    time: number;
    ids: DeliverableNoteId[];
    statuses: DeliverableNoteStatus[];
  }> = [];
  for (const { note, t } of timed) {
    const last = markers.at(-1);
    if (last !== undefined && (t - last.time) / durationSeconds < minGap) {
      last.ids.push(note.id);
      last.statuses.push(note.status);
    } else {
      markers.push({ time: t, ids: [note.id], statuses: [note.status] });
    }
  }
  return markers.map((marker) => ({
    position: marker.time / durationSeconds,
    time: marker.time,
    noteIds: marker.ids,
    status: mostUrgentStatus(marker.statuses),
  }));
}
