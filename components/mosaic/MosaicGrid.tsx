"use client";

import { useMemo } from "react";
import { StencilBlock } from "./StencilBlock";
import { GRID_SIZE, blockId as bid, type BlockData } from "@/lib/mosaic/engine";
import type { MouseEvent as ReactMouseEvent } from "react";

interface Props {
  blocks: Map<string, BlockData>;
  isColorMode?: boolean;
  selectedBlock?: string | null;
  highlightedBlock?: string | null;
  onBlockClick?: (id: string) => void;
  onBlockHoverStart?: (
    id: string,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onBlockHoverMove?: (
    id: string,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onBlockHoverEnd?: () => void;
  className?: string;
}

export function MosaicGrid({
  blocks,
  isColorMode = false,
  selectedBlock = null,
  highlightedBlock = null,
  onBlockClick,
  onBlockHoverStart,
  onBlockHoverMove,
  onBlockHoverEnd,
  className = "",
}: Props) {
  const blockIds = useMemo(() => {
    const ids: string[] = [];
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++) ids.push(bid(r, c));
    return ids;
  }, []);

  return (
    <div
      className={`grid aspect-square overflow-hidden ${className}`}
      style={{
        gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
        border: "20px solid #5c3517",
        borderImage:
          "linear-gradient(140deg, #2a1709, #8a5426, #d0a66d, #fff4d0, #7a461d, #2b1608) 1",
        boxShadow:
          "0 34px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,231,197,0.35), inset 0 0 50px rgba(0,0,0,0.82), inset 0 0 0 2px rgba(255,229,187,0.2)",
        background: "#000",
      }}
    >
      {blockIds.map((id) => (
        <StencilBlock
          key={id}
          id={id}
          data={blocks.get(id) ?? null}
          isSelected={id === selectedBlock}
          isColorMode={isColorMode}
          isHighlighted={id === highlightedBlock}
          onClick={onBlockClick}
          onHoverStart={onBlockHoverStart}
          onHoverMove={onBlockHoverMove}
          onHoverEnd={onBlockHoverEnd}
        />
      ))}
    </div>
  );
}
