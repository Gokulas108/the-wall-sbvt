"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BlockData } from "@/lib/mosaic/engine";
import {
  NAMES_PER_BLOCK,
  GRID_SIZE,
  blockId as bid,
} from "@/lib/mosaic/engine";

const API = "/api";
const LOAD_CONCURRENCY = 8;

export function useBlockData() {
  const [blocks, setBlocks] = useState<Map<string, BlockData>>(new Map());
  const [loading, setLoading] = useState(true);
  const blocksRef = useRef(blocks);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // Fetch all blocks summary then individual names
  const loadAll = useCallback(async () => {
    try {
      const allRes = await fetch(`${API}/blocks`);
      const all: Record<string, { total_qty: number }> = await allRes.json();
      const ids = Object.keys(all);
      const nameResults: BlockData[] = [];
      for (let idx = 0; idx < ids.length; idx += LOAD_CONCURRENCY) {
        const chunk = ids.slice(idx, idx + LOAD_CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async (id) => {
            const res = await fetch(`${API}/blocks/${id}/names`);
            return res.json() as Promise<BlockData>;
          }),
        );
        nameResults.push(...chunkResults);
      }
      const map = new Map<string, BlockData>();
      for (const d of nameResults) map.set(d.block_id, d);
      setBlocks(map);
    } catch {
      /* swallow */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  const getBlock = useCallback(
    (id: string): BlockData | null => blocksRef.current.get(id) ?? null,
    [],
  );

  const fetchBlock = useCallback(async (id: string): Promise<BlockData> => {
    const res = await fetch(`${API}/blocks/${id}/names`);
    const d: BlockData = await res.json();
    setBlocks((prev) => {
      const next = new Map(prev);
      next.set(id, d);
      return next;
    });
    return d;
  }, []);

  const updateBlock = useCallback((id: string, data: BlockData) => {
    setBlocks((prev) => {
      const next = new Map(prev);
      next.set(id, data);
      return next;
    });
  }, []);

  const addName = useCallback(async (id: string, name: string, qty: number) => {
    const res = await fetch(`${API}/blocks/${id}/names`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, qty }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    setBlocks((prev) => {
      const next = new Map(prev);
      next.set(id, d);
      return next;
    });
    return d;
  }, []);

  const deleteName = useCallback(async (blockIdStr: string, nameId: number) => {
    const res = await fetch(`${API}/blocks/${blockIdStr}/names/${nameId}`, {
      method: "DELETE",
    });
    const d: BlockData = await res.json();
    setBlocks((prev) => {
      const next = new Map(prev);
      next.set(blockIdStr, d);
      return next;
    });
    return d;
  }, []);

  const submitDonation = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const res = await fetch(`${API}/blocks/${id}/donate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setBlocks((prev) => {
        const next = new Map(prev);
        next.set(id, d);
        return next;
      });
      return d;
    },
    [],
  );

  const submitPledge = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const res = await fetch(`${API}/blocks/${id}/pledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setBlocks((prev) => {
        const next = new Map(prev);
        next.set(id, d);
        return next;
      });
      return d;
    },
    [],
  );

  const findSuggested = useCallback((): string | null => {
    let bestId: string | null = null;
    let bestUsed = Number.MAX_SAFE_INTEGER;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const id = bid(r, c);
        const d = blocksRef.current.get(id);
        const used = d?.total_used ?? 0;
        if (used >= NAMES_PER_BLOCK) continue;
        if (used < bestUsed) {
          bestUsed = used;
          bestId = id;
        }
      }
    }
    return bestId;
  }, []);

  return {
    blocks,
    loading,
    getBlock,
    fetchBlock,
    updateBlock,
    addName,
    deleteName,
    submitDonation,
    submitPledge,
    findSuggested,
    reload: loadAll,
  };
}
