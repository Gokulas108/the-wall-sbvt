// Core mosaic constants & text generation
// Pure functions — zero DOM dependencies

export const GRID_SIZE = 10;
export const NAMES_PER_BLOCK = 150;
export const COST_PER_NAME = 1000;
export const GOAL = NAMES_PER_BLOCK * GRID_SIZE * GRID_SIZE * COST_PER_NAME;

export const DEFAULT_MANTRA =
  "namo bhakti vinodāya sac cid ānanda nāmine gaura śakti svarūpāya rūpānuga varāya te";
export const MANTRA_WORDS = DEFAULT_MANTRA.split(" ");

export const SEPARATOR = "\u200A"; // hair-space
export const RENDER_MIN = NAMES_PER_BLOCK * 8;

export interface NameEntry {
  id: number;
  name: string;
  qty: number;
  created_at?: string;
  createdAt?: string;
}

export interface BlockData {
  block_id: string;
  names: NameEntry[];
  total_used: number;
  remaining: number;
}

export interface DonorEvent {
  type: "donation" | "pledge";
  blockId: string;
  name: string;
  qty: number;
  amount: number;
}

export function blockId(row: number, col: number): string {
  return String.fromCharCode(65 + col) + (row + 1);
}

export function parseBlockId(id: string): { row: number; col: number } {
  return {
    row: parseInt(id.slice(1), 10) - 1,
    col: id.charCodeAt(0) - 65,
  };
}

export function backgroundPosition(row: number, col: number): string {
  return `${(col / (GRID_SIZE - 1)) * 100}% ${(row / (GRID_SIZE - 1)) * 100}%`;
}

export function generateNameList(data: BlockData | null): string[] {
  const names = generateCellList(data);
  let idx = names.length;
  while (names.length < RENDER_MIN) {
    names.push(MANTRA_WORDS[idx % MANTRA_WORDS.length]);
    idx++;
  }
  return names;
}

export function generateCellList(data: BlockData | null): string[] {
  const names: string[] = [];
  if (data?.names.length) {
    for (const entry of data.names) {
      for (let i = 0; i < entry.qty; i++) names.push(entry.name);
    }
  }
  let idx = 0;
  while (names.length < NAMES_PER_BLOCK) {
    names.push(MANTRA_WORDS[idx % MANTRA_WORDS.length]);
    idx++;
  }
  names.length = NAMES_PER_BLOCK;
  return names;
}

export function baseText(data: BlockData | null): string {
  return generateNameList(data).join(SEPARATOR);
}

export function getFilledSlots(data: BlockData | null): number {
  if (!data) return 0;
  const usedByEntries = data.names.reduce(
    (sum, entry) => sum + Math.max(0, entry.qty),
    0,
  );
  return Math.max(
    0,
    Math.min(NAMES_PER_BLOCK, data.total_used || usedByEntries),
  );
}

export function colorMarkup(data: BlockData | null): string {
  if (!data?.names.length) return "";
  const nl = generateNameList(data);
  const filledSlots = getFilledSlots(data);
  return nl
    .map((n, i) => {
      const sep = i < nl.length - 1 ? SEPARATOR : "";
      const escaped = escapeHtml(n);
      return i < filledSlots
        ? escaped + sep
        : `<span class="hf" style="visibility:hidden;">${escaped}</span>${sep}`;
    })
    .join("");
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatINR(n: number): string {
  return n.toLocaleString("en-IN");
}
