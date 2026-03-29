"use client";

import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import {
  generateCellList,
  getFilledSlots,
  GRID_SIZE,
  parseBlockId,
  type BlockData,
} from "@/lib/mosaic/engine";

const BLOCK_CELL_COLS = 15;
const BLOCK_CELL_ROWS = 10;
const TOTAL_CELL_COLS = GRID_SIZE * BLOCK_CELL_COLS;
const TOTAL_CELL_ROWS = GRID_SIZE * BLOCK_CELL_ROWS;
const FULL_BG_SIZE = `${TOTAL_CELL_COLS * 100}% ${TOTAL_CELL_ROWS * 100}%`;

interface Props {
  id: string;
  data: BlockData | null;
  isSelected?: boolean;
  isColorMode?: boolean;
  isHighlighted?: boolean;
  onClick?: (id: string) => void;
  onHoverStart?: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverMove?: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverEnd?: () => void;
}

export const StencilBlock = memo(function StencilBlock({
  id,
  data,
  isSelected = false,
  isColorMode = false,
  isHighlighted = false,
  onClick,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
}: Props) {
  void isSelected;
  void isColorMode;

  const cells = useMemo(() => generateCellList(data), [data]);
  const filledSlots = useMemo(() => getFilledSlots(data), [data]);
  const { row, col } = parseBlockId(id);
  const hasHover = Boolean(onHoverStart || onHoverMove || onHoverEnd);
  const isClickable = Boolean(onClick);

  return (
    <div
      className={`relative bg-black overflow-hidden ${isClickable ? "cursor-pointer" : ""} ${hasHover ? "group" : ""}`}
      style={{
        width: "calc(100% + 0.35px)",
        height: "calc(100% + 0.35px)",
        marginRight: "-0.35px",
        marginBottom: "-0.35px",
      }}
      onClick={isClickable ? () => onClick?.(id) : undefined}
      onMouseEnter={hasHover ? (event) => onHoverStart?.(id, event) : undefined}
      onMouseMove={hasHover ? (event) => onHoverMove?.(id, event) : undefined}
      onMouseLeave={hasHover ? onHoverEnd : undefined}
    >
      {/* Highlight glow */}
      {isHighlighted && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            boxShadow:
              "inset 0 0 20px rgba(201, 107, 27, 0.6), 0 0 30px rgba(201, 107, 27, 0.4)",
          }}
        />
      )}

      {/* Hover overlay */}
      <div
        className={`absolute inset-0 z-5 pointer-events-none transition-all duration-150 ${hasHover ? "opacity-0 group-hover:opacity-100" : "opacity-0"}`}
        style={{
          background: "rgba(201, 107, 27, 0.18)",
          boxShadow:
            "inset 0 0 0 2px rgba(232, 170, 50, 0.75), inset 0 0 20px rgba(201, 107, 27, 0.35)",
        }}
      />

      <div className="absolute inset-0 overflow-hidden">
        <div
          style={{
            position: "absolute",
            left: `${-col * 100}%`,
            top: `${-row * 100}%`,
            width: `${GRID_SIZE * 100}%`,
            height: `${GRID_SIZE * 100}%`,
            backgroundImage: 'url("/sbvt.jpg")',
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
            filter: "grayscale(1) contrast(1.08) brightness(0.92)",
          }}
        />
      </div>

      <div
        className="absolute inset-0 grid pointer-events-none"
        style={{
          gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
          gridTemplateRows: "repeat(10, minmax(0, 1fr))",
          gap: "0",
          padding: "0",
          zIndex: 5,
        }}
      >
        {Array.from({ length: filledSlots }).map((_, index) => {
          const cellCol = index % BLOCK_CELL_COLS;
          const cellRow = Math.floor(index / BLOCK_CELL_COLS);
          const gridColumn = cellCol + 1;
          const gridRow = cellRow + 1;
          const globalCol = col * BLOCK_CELL_COLS + cellCol;
          const globalRow = row * BLOCK_CELL_ROWS + cellRow;
          const bgX = (globalCol / (TOTAL_CELL_COLS - 1)) * 100;
          const bgY = (globalRow / (TOTAL_CELL_ROWS - 1)) * 100;
          return (
            <div
              key={`${id}-filled-${index}`}
              style={{
                gridColumn,
                gridRow,
                backgroundImage: 'url("/sbvt.jpg")',
                backgroundSize: FULL_BG_SIZE,
                backgroundPosition: `${bgX}% ${bgY}%`,
                backgroundRepeat: "no-repeat",
              }}
            />
          );
        })}
      </div>

      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
          gridTemplateRows: "repeat(10, minmax(0, 1fr))",
          gap: "0",
          padding: "0",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {cells.map((label, index) => {
          const isFilled = index < filledSlots;
          const gridColumn = (index % 15) + 1;
          const gridRow = Math.floor(index / 15) + 1;
          return (
            <div
              key={`${id}-${index}`}
              className="flex items-center justify-center overflow-hidden"
              style={{
                gridColumn,
                gridRow,
                background: isFilled ? "transparent" : "rgba(18, 18, 18, 0.5)",
                border: "none",
                color: isFilled
                  ? "rgba(255,248,238,0.05)"
                  : "rgba(245,245,245,0.12)",
                fontSize: "1px",
                lineHeight: 0.95,
                fontWeight: isFilled ? 600 : 700,
                letterSpacing: "0.01em",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
});
