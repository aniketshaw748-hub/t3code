/** Leaving a unit without a partner costs this; a pair of unrelated units costs two of them. */
const GAP_COST = 0.5;

/** A unit of each side lined up; null on the side that has no partner. */
export interface AlignedPair {
  readonly baseIndex: number | null;
  readonly targetIndex: number | null;
  /** True when the partner sits at another place in the order, so the unit was moved. */
  readonly moved?: boolean;
}

/**
 * What pairing two units costs: 0 for the same unit, 1 for two so unlike that pairing them is
 * worth no more than dropping one and adding the other. Past 1 they are never paired.
 */
export type PairingCost = (baseIndex: number, targetIndex: number) => number;

/**
 * Lines two ordered lists up by content, keeping their order. A unit added in the middle leaves
 * the units after it with their true partners, because pairing two different units costs as much
 * as dropping one and adding the other, while every unit skipped costs on top of that.
 */
export function alignUnits(
  baseCount: number,
  targetCount: number,
  cost: PairingCost,
): ReadonlyArray<AlignedPair> {
  // Equal units at both ends pair up without the table: most edits touch a few units.
  let lead = 0;
  while (lead < baseCount && lead < targetCount && cost(lead, lead) === 0) lead++;
  let tail = 0;
  while (
    tail < baseCount - lead &&
    tail < targetCount - lead &&
    cost(baseCount - 1 - tail, targetCount - 1 - tail) === 0
  ) {
    tail++;
  }
  const rows = baseCount - lead - tail;
  const columns = targetCount - lead - tail;
  const width = columns + 1;
  const costs = new Float32Array(rows * columns);
  const total = new Float64Array((rows + 1) * width);
  for (let i = 1; i <= rows; i++) total[i * width] = i * GAP_COST;
  for (let j = 1; j <= columns; j++) total[j] = j * GAP_COST;
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      const pairing = Math.max(0, cost(lead + i - 1, lead + j - 1));
      costs[(i - 1) * columns + (j - 1)] = pairing;
      total[i * width + j] = Math.min(
        total[(i - 1) * width + (j - 1)]! + costs[(i - 1) * columns + (j - 1)]!,
        total[(i - 1) * width + j]! + GAP_COST,
        total[i * width + (j - 1)]! + GAP_COST,
      );
    }
  }
  // Walked back from the end, a pair wins a tie: a unit replaced in place reads as changed.
  const middle: AlignedPair[] = [];
  let i = rows;
  let j = columns;
  while (i > 0 || j > 0) {
    const here = total[i * width + j]!;
    if (
      i > 0 &&
      j > 0 &&
      here === total[(i - 1) * width + (j - 1)]! + costs[(i - 1) * columns + (j - 1)]!
    ) {
      middle.push({ baseIndex: lead + i - 1, targetIndex: lead + j - 1 });
      i--;
      j--;
    } else if (i > 0 && here === total[(i - 1) * width + j]! + GAP_COST) {
      middle.push({ baseIndex: lead + i - 1, targetIndex: null });
      i--;
    } else {
      middle.push({ baseIndex: null, targetIndex: lead + j - 1 });
      j--;
    }
  }
  const pairs: AlignedPair[] = [];
  for (let index = 0; index < lead; index++) pairs.push({ baseIndex: index, targetIndex: index });
  pairs.push(...middle.reverse());
  for (let index = tail; index > 0; index--) {
    pairs.push({ baseIndex: baseCount - index, targetIndex: targetCount - index });
  }
  return pairs;
}

/**
 * Pairs units left without a partner on both sides when they are the same unit, closest first:
 * a unit taken out in one place and put in at another was moved, not removed and added.
 */
export function withMoves(
  pairs: ReadonlyArray<AlignedPair>,
  cost: PairingCost,
  sameUnitBelow: number,
): ReadonlyArray<AlignedPair> {
  const removed = pairs.flatMap((pair) => (pair.targetIndex === null ? [pair.baseIndex!] : []));
  const added = pairs.flatMap((pair) => (pair.baseIndex === null ? [pair.targetIndex!] : []));
  if (removed.length === 0 || added.length === 0) return pairs;
  const candidates = removed
    .flatMap((baseIndex) =>
      added.map((targetIndex) => ({ baseIndex, targetIndex, cost: cost(baseIndex, targetIndex) })),
    )
    .filter((candidate) => candidate.cost < sameUnitBelow)
    .toSorted((a, b) => a.cost - b.cost);
  const partnerOfTarget = new Map<number, number>();
  const movedBase = new Set<number>();
  for (const candidate of candidates) {
    if (movedBase.has(candidate.baseIndex) || partnerOfTarget.has(candidate.targetIndex)) continue;
    movedBase.add(candidate.baseIndex);
    partnerOfTarget.set(candidate.targetIndex, candidate.baseIndex);
  }
  if (movedBase.size === 0) return pairs;
  return pairs.flatMap((pair): ReadonlyArray<AlignedPair> => {
    if (pair.targetIndex === null) return movedBase.has(pair.baseIndex!) ? [] : [pair];
    const baseIndex = pair.baseIndex === null ? partnerOfTarget.get(pair.targetIndex) : undefined;
    return baseIndex === undefined ? [pair] : [{ ...pair, baseIndex, moved: true }];
  });
}
