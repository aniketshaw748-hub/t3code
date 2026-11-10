import type { DeliverableRegion } from "@t3tools/contracts";

/** Side of the square RGB grid each sampled video frame is reduced to. */
export const VIDEO_GRID = 128;
/** Side of the grid a slide, page or image keeps for lining units up, never for the verdict. */
export const OUTLINE_GRID = 96;

/**
 * A pixel counts as changed when a channel lies this far (0-255) outside what the other version
 * shows there, give or take half a pixel of anti-aliasing. The step is above what a re-encode
 * does to a flat area.
 */
const DETAIL_THRESHOLD = 16;
/** Fewer changed pixels than this in a whole unit is a speck, not an edit. */
const MIN_CHANGED_PIXELS = 4;
/** Side of the tiles that may each slide by a pixel to line up with the other version. */
const TILE = 16;
/** The no-shift case first, so a tile only counts as shifted when that explains more. */
const SHIFTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** Room kept around a change, as a fraction of the frame's width and height. */
const REGION_MARGIN = 0.025;
/** An outline cell differs past this step in any channel (0-255); rendering noise stays under it. */
const OUTLINE_THRESHOLD = 12;

/** RGB pixels, row by row: a slide at display size, or one video frame on its grid. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** How much of what rendering and encoding do to a picture is forgiven before it counts. */
export interface RasterTolerance {
  /**
   * Lets each tile slide one pixel before it is compared, so content that moved by a pixel reads
   * as the same. Right at display size; wrong on a video grid, where one cell is many pixels.
   */
  readonly pixelShift: boolean;
  /**
   * A pixel also counts as changed when the area around it moved this far (0-255) on average in
   * one direction: a tint or grade too faint for any single pixel, which noise never adds up to.
   */
  readonly toneThreshold: number;
  /** How far that area reaches from the pixel, as a fraction of the raster's longer side. */
  readonly toneReach: number;
}

/** Slides, pages and images at display size: the same content renders the same, to the pixel. */
export const DISPLAY_TOLERANCE: RasterTolerance = {
  pixelShift: true,
  toneThreshold: 4,
  toneReach: 1 / 32,
};

/**
 * Video frames on their grid. A hard re-encode drifts the tone of flat, grainy areas by a few
 * steps, so tone is averaged wider and has to move further than on a slide.
 */
export const VIDEO_TOLERANCE: RasterTolerance = {
  pixelShift: false,
  toneThreshold: 5,
  toneReach: 1 / 16,
};

export type UnitSignature =
  | { readonly type: "pixels"; readonly outline: Uint8Array }
  | { readonly type: "hash"; readonly value: string };

export interface UnitDifference {
  /** Fraction of the unit's area that changed; 0 means it reads as the same. */
  readonly difference: number;
  /** Where it changed, framed with a margin; null when nothing did or it could not be placed. */
  readonly region: DeliverableRegion | null;
}

export const SAME: UnitDifference = { difference: 0, region: null };
const WHOLE: UnitDifference = { difference: 1, region: { x: 0, y: 0, w: 1, h: 1 } };

/**
 * For every channel of every pixel, the range it could take if the picture sat half a pixel
 * off in any direction: halfway to the lowest and highest of the 3x3 pixels around it.
 */
function halfPixelRange({ width, data }: Raster) {
  const rowLow = new Uint8Array(data.length);
  const rowHigh = new Uint8Array(data.length);
  const low = new Uint8Array(data.length);
  const high = new Uint8Array(data.length);
  const stride = width * 3;
  for (let i = 0; i < data.length; i++) {
    const column = i % stride;
    const left = column >= 3 ? data[i - 3]! : data[i]!;
    const right = column < stride - 3 ? data[i + 3]! : data[i]!;
    rowLow[i] = Math.min(left, data[i]!, right);
    rowHigh[i] = Math.max(left, data[i]!, right);
  }
  for (let i = 0; i < data.length; i++) {
    const above = i >= stride ? i - stride : i;
    const below = i + stride < data.length ? i + stride : i;
    const value = data[i]!;
    low[i] = value - ((value - Math.min(rowLow[above]!, rowLow[i]!, rowLow[below]!)) >> 1);
    high[i] = value + ((Math.max(rowHigh[above]!, rowHigh[i]!, rowHigh[below]!) - value) >> 1);
  }
  return { low, high };
}

/** Drops changed pixels with none beside them: a lone pixel is noise, never an edit. */
function withoutSpecks(changed: Uint8Array, width: number, height: number): Uint8Array {
  const kept = new Uint8Array(changed.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (changed[y * width + x] === 0) continue;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          if ((nx !== x || ny !== y) && changed[ny * width + nx] === 1) kept[y * width + x] = 1;
        }
      }
    }
  }
  return kept;
}

interface Registration {
  /** 1 for each pixel no allowed shift of its tile explains. */
  readonly changed: Uint8Array;
  /** Per tile, the shift of `b` that fits `a` best, as an offset into `b.data`. */
  readonly tileOffsets: Int32Array;
  readonly tilesAcross: number;
}

/**
 * Lines the two rasters up tile by tile and marks the pixels that still disagree. A tile that
 * matches as it stands is never shifted; one that does not takes the shift leaving fewest misfits.
 */
function register(a: Raster, b: Raster, tolerance: RasterTolerance): Registration {
  const { width, height } = a;
  const rangeA = halfPixelRange(a);
  const rangeB = halfPixelRange(b);
  const tilesAcross = Math.ceil(width / TILE);
  const tilesDown = Math.ceil(height / TILE);
  const changed = new Uint8Array(width * height);
  const tileOffsets = new Int32Array(tilesAcross * tilesDown);
  const misfits = new Int32Array(TILE * TILE);
  const best = new Int32Array(TILE * TILE);
  const shifts = tolerance.pixelShift ? SHIFTS : SHIFTS.slice(0, 1);

  /** Pixels of the tile at (x0, y0) that disagree with `b` moved by (dx, dy); listed in `misfits`. */
  const misfitsAt = (x0: number, y0: number, dx: number, dy: number, limit: number) => {
    let count = 0;
    const x1 = Math.min(width, x0 + TILE);
    const y1 = Math.min(height, y0 + TILE);
    for (let y = y0; y < y1; y++) {
      const by = Math.min(height - 1, Math.max(0, y + dy));
      for (let x = x0; x < x1; x++) {
        const bx = Math.min(width - 1, Math.max(0, x + dx));
        const pa = (y * width + x) * 3;
        const pb = (by * width + bx) * 3;
        for (let channel = 0; channel < 3; channel++) {
          const va = a.data[pa + channel]!;
          const vb = b.data[pb + channel]!;
          if (
            va - rangeB.high[pb + channel]! > DETAIL_THRESHOLD ||
            rangeB.low[pb + channel]! - va > DETAIL_THRESHOLD ||
            vb - rangeA.high[pa + channel]! > DETAIL_THRESHOLD ||
            rangeA.low[pa + channel]! - vb > DETAIL_THRESHOLD
          ) {
            misfits[count++] = y * width + x;
            break;
          }
        }
        if (count >= limit) return count;
      }
    }
    return count;
  };

  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      let bestCount = Number.POSITIVE_INFINITY;
      let bestOffset = 0;
      for (const [dx, dy] of shifts) {
        const count = misfitsAt(tx * TILE, ty * TILE, dx, dy, bestCount);
        if (count >= bestCount) continue;
        bestCount = count;
        bestOffset = (dy * width + dx) * 3;
        best.set(misfits.subarray(0, count));
        if (count === 0) break;
      }
      tileOffsets[ty * tilesAcross + tx] = bestOffset;
      for (let i = 0; i < bestCount; i++) changed[best[i]!] = 1;
    }
  }
  return { changed: withoutSpecks(changed, width, height), tileOffsets, tilesAcross };
}

/**
 * Adds pixels whose neighbourhood shifted in tone. Pixels that already changed in detail, and
 * the ones touching them, stay out of the averages so an edit does not smear into its surroundings.
 */
function addToneChanges(
  a: Raster,
  b: Raster,
  { changed, tileOffsets, tilesAcross }: Registration,
  tolerance: RasterTolerance,
): void {
  const { width, height } = a;
  const radius = Math.max(1, Math.round(Math.max(width, height) * tolerance.toneReach));
  const span = width + 1;
  // Summed-area tables: how many pixels count, and their signed step per channel.
  const counted = new Int32Array(span * (height + 1));
  const steps = [0, 1, 2].map(() => new Int32Array(span * (height + 1)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let quiet = 1;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && quiet === 1; ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          if (changed[ny * width + nx] === 1) quiet = 0;
        }
      }
      const pa = (y * width + x) * 3;
      // The tile's shift, held inside the raster at its edges.
      const offset = tileOffsets[Math.floor(y / TILE) * tilesAcross + Math.floor(x / TILE)]!;
      const pb = pa + offset >= 0 && pa + offset < b.data.length ? pa + offset : pa;
      const at = (y + 1) * span + (x + 1);
      counted[at] = quiet + counted[at - 1]! + counted[at - span]! - counted[at - span - 1]!;
      for (let channel = 0; channel < 3; channel++) {
        const table = steps[channel]!;
        const step = quiet === 1 ? a.data[pa + channel]! - b.data[pb + channel]! : 0;
        table[at] = step + table[at - 1]! + table[at - span]! - table[at - span - 1]!;
      }
    }
  }
  const sum = (table: Int32Array, x0: number, y0: number, x1: number, y1: number) =>
    table[y1 * span + x1]! -
    table[y0 * span + x1]! -
    table[y1 * span + x0]! +
    table[y0 * span + x0]!;
  const toned: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (changed[y * width + x] === 1) continue;
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(width, x + radius + 1);
      const y1 = Math.min(height, y + radius + 1);
      const pixels = sum(counted, x0, y0, x1, y1);
      // An average over a sliver left between edits says nothing about tone.
      if (pixels * 4 < (x1 - x0) * (y1 - y0)) continue;
      const limit = tolerance.toneThreshold * pixels;
      if (steps.some((table) => Math.abs(sum(table, x0, y0, x1, y1)) > limit)) {
        toned.push(y * width + x);
      }
    }
  }
  for (const pixel of toned) changed[pixel] = 1;
}

/**
 * Grows a box by the margin, inside the frame. A changed word is a few pixels tall, so an
 * outline drawn on its exact box would sit on top of the very thing it points at.
 */
export function frameRegion(region: DeliverableRegion): DeliverableRegion {
  const x = Math.max(0, region.x - REGION_MARGIN);
  const y = Math.max(0, region.y - REGION_MARGIN);
  return {
    x,
    y,
    w: Math.min(1, region.x + region.w + REGION_MARGIN) - x,
    h: Math.min(1, region.y + region.h + REGION_MARGIN) - y,
  };
}

/** How much of a unit changed between two rasters of it, and the framed box around what did. */
export function rasterDifference(a: Raster, b: Raster, tolerance: RasterTolerance): UnitDifference {
  const { width, height } = a;
  const pixels = width * height;
  // A different shape is a different frame: there is no pixel to compare with.
  if (b.width !== width || b.height !== height) return WHOLE;
  if (a.data.length !== pixels * 3 || b.data.length !== pixels * 3) return WHOLE;
  const registration = register(a, b, tolerance);
  addToneChanges(a, b, registration, tolerance);
  const { changed } = registration;
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < pixels; i++) {
    if (changed[i] === 0) continue;
    count++;
    const x = i % width;
    const y = Math.floor(i / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (count < MIN_CHANGED_PIXELS) return SAME;
  return {
    difference: count / pixels,
    region: frameRegion({
      x: minX / width,
      y: minY / height,
      w: (maxX - minX + 1) / width,
      h: (maxY - minY + 1) / height,
    }),
  };
}

/** Fraction of outline cells that differ: rough, and only good for telling units apart. */
export function outlineDifference(a: Uint8Array, b: Uint8Array): number {
  const cells = OUTLINE_GRID * OUTLINE_GRID;
  if (a.length !== cells * 3 || b.length !== cells * 3) return 1;
  let differing = 0;
  for (let i = 0; i < cells; i++) {
    const o = i * 3;
    const step = Math.max(
      Math.abs(a[o]! - b[o]!),
      Math.abs(a[o + 1]! - b[o + 1]!),
      Math.abs(a[o + 2]! - b[o + 2]!),
    );
    if (step > OUTLINE_THRESHOLD) differing++;
  }
  return differing / cells;
}

/**
 * For two units whose display images differ but could not be read as pixels: a change with no
 * region, sized by the outlines and never nothing.
 */
export function unmeasuredDifference(a: UnitSignature, b: UnitSignature): UnitDifference {
  const rough =
    a.type === "pixels" && b.type === "pixels" ? outlineDifference(a.outline, b.outline) : 1;
  return { difference: Math.max(rough, 1 / (OUTLINE_GRID * OUTLINE_GRID)), region: null };
}

export const unionRegion = (
  a: DeliverableRegion | null,
  b: DeliverableRegion | null,
): DeliverableRegion | null => {
  if (a === null) return b;
  if (b === null) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};
