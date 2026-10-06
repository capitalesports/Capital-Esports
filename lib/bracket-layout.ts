/**
 * Where each bracket card sits and which lines join them (pure; DECISIONS M50).
 * Round r's entrants are last round's bye first, then the winners in match order (see
 * lib/tournament.ts), so match i of round r is fed by entrants 2i and 2i+1 and the bye by the last.
 * Positions are in "slots" (one card plus its gap); the view multiplies by its card pitch.
 */

export interface LayoutItem {
  kind: "match" | "bye";
  /** Match index in its round (0 for the bye). */
  index: number;
  /** Top of the card, in slots. */
  y: number;
}

export interface LayoutColumn {
  round: number;
  items: LayoutItem[];
}

export interface LayoutEdge {
  /** Column of the source card (the target is the next column). */
  fromCol: number;
  fromY: number;
  toY: number;
}

export interface BracketLayout {
  columns: LayoutColumn[];
  edges: LayoutEdge[];
  /** Height in slots. */
  height: number;
}

export function bracketLayout(rounds: { matches: number; byes: number }[]): BracketLayout {
  const columns: LayoutColumn[] = [];
  const edges: LayoutEdge[] = [];
  for (const [ci, r] of rounds.entries()) {
    const prev = columns[ci - 1];
    const prevRound = rounds[ci - 1];
    /** The card in the previous column that entrant `e` of this round comes from. */
    const sourceOf = (e: number): LayoutItem | undefined => {
      if (!prev || !prevRound) return undefined;
      if (prevRound.byes) {
        return e === 0
          ? prev.items.find((i) => i.kind === "bye")
          : prev.items.find((i) => i.kind === "match" && i.index === e - 1);
      }
      return prev.items.find((i) => i.kind === "match" && i.index === e);
    };
    const placed: { item: LayoutItem; sources: LayoutItem[] }[] = [];
    if (ci === 0) {
      // Round 1: the bye on top (it meets the first winner next round), then the matches.
      let y = 0;
      if (r.byes) placed.push({ item: { kind: "bye", index: 0, y: y++ }, sources: [] });
      for (let i = 0; i < r.matches; i++)
        placed.push({ item: { kind: "match", index: i, y: y++ }, sources: [] });
    } else {
      const entrants = r.matches * 2 + r.byes;
      for (let i = 0; i < r.matches; i++) {
        const sources = [sourceOf(2 * i), sourceOf(2 * i + 1)].filter((s): s is LayoutItem => !!s);
        const y = sources.reduce((sum, s) => sum + s.y, 0) / Math.max(1, sources.length);
        placed.push({ item: { kind: "match", index: i, y }, sources });
      }
      if (r.byes) {
        const source = sourceOf(entrants - 1);
        placed.push({
          item: { kind: "bye", index: 0, y: source?.y ?? 0 },
          sources: source ? [source] : [],
        });
      }
      // Keep cards from overlapping: at least one slot apart, in their computed order.
      placed.sort((a, b) => a.item.y - b.item.y);
      for (let k = 1; k < placed.length; k++) {
        const min = placed[k - 1]!.item.y + 1;
        if (placed[k]!.item.y < min) placed[k]!.item.y = min;
      }
    }
    for (const p of placed)
      for (const s of p.sources) edges.push({ fromCol: ci - 1, fromY: s.y, toY: p.item.y });
    columns.push({ round: ci + 1, items: placed.map((p) => p.item) });
  }
  const height = Math.max(0, ...columns.flatMap((c) => c.items.map((i) => i.y + 1)));
  return { columns, edges, height };
}
