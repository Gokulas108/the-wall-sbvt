"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  GRID_SIZE,
  generateCellList,
  getFilledSlots,
  blockId as bid,
  parseBlockId,
  type BlockData,
} from "@/lib/mosaic/engine";

/**
 * WallFrame (Brick Version) — renders the wall-of-legacy portrait as a grid of masonry bricks.
 *
 * Architecture:
 * - A background <img> holds the full color source image (filled bricks show through).
 * - The <canvas> draws grayscale image chunks for unfilled bricks, and leaves
 *   filled bricks transparent so the color image shines through.
 * - Exactly 150 bricks per block, 10 rows × 15 bricks.
 * - Each brick's width is proportional to the name's measured text width,
 *   scaled so the row sums exactly to blockW — creating a true masonry effect.
 */

const FONT_FAMILY = '"Arial Narrow", Arial, sans-serif';
const IMG_SRC = "/sbvt.jpg";

interface Props {
  blocks: Map<string, BlockData>;
  className?: string;
  singleBlockId?: string | null;
  selectedBlockId?: string | null;
  highlightName?: string | null;
  onBlockClick?: (id: string) => void;
  onBlockHover?: (id: string | null) => void;
  onFirstPaint?: () => void;
}

export function WallFrame({ blocks, className = "", singleBlockId = null, selectedBlockId = null, highlightName = null, onBlockClick, onBlockHover, onFirstPaint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Load source image for grayscale rendering
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setImageLoaded(true); };
    img.src = IMG_SRC;
  }, []);

  useEffect(() => {
    if (!imageLoaded) return;
    const doc = document as Document & { fonts?: FontFaceSet };
    if (doc.fonts?.ready) doc.fonts.ready.then(() => setReady(true));
    else setReady(true);
  }, [imageLoaded]);

  // Parse singleBlockId for image positioning
  const singleParsed = singleBlockId ? parseBlockId(singleBlockId) : null;
  const singleRow = singleParsed?.row ?? -1;
  const singleCol = singleParsed?.col ?? -1;

  const renderWall = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img) return;

    const dpr = window.devicePixelRatio || 1;
    
    // Use clientWidth/clientHeight to get exact padding-box dimensions, immune to subpixel borders
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    // Ensure canvas buffer covers all layout pixels
    const pixelW = Math.ceil(w * dpr);
    const pixelH = Math.ceil(h * dpr);

    canvas.width = pixelW;
    canvas.height = pixelH;
    
    // Remove inline style overrides so 'w-full h-full' CSS dictates visual size
    canvas.style.width = '';
    canvas.style.height = '';

    const ctx = canvas.getContext("2d", { alpha: true })!;
    
    // Scale context precisely so drawing [0, w] maps exactly to [0, pixelW] buffer pixels
    ctx.setTransform(pixelW / w, 0, 0, pixelH / h, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Prepare grayscale offscreen of the full image in TRUE resolution
    const grayOff = document.createElement("canvas");
    grayOff.width = img.naturalWidth;
    grayOff.height = img.naturalHeight;
    const grayCtx = grayOff.getContext("2d")!;
    
    // Draw the original image first
    grayCtx.drawImage(img, 0, 0);
    
    // Manual pixel manipulation for reliable grayscale in iOS Safari
    try {
      const imageData = grayCtx.getImageData(0, 0, grayOff.width, grayOff.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Standard luminance
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        // Apply brightness(0.7)
        const adjustedGray = Math.min(255, gray * 0.7);
        data[i] = adjustedGray;     // Red
        data[i + 1] = adjustedGray; // Green
        data[i + 2] = adjustedGray; // Blue
        // Alpha (data[i + 3]) remains unchanged
      }
      grayCtx.putImageData(imageData, 0, 0);
    } catch (e) {
      // Fallback for unexpected CORS/tainted canvas issues
      grayCtx.filter = "grayscale(1) brightness(0.7)";
      grayCtx.drawImage(img, 0, 0);
      grayCtx.filter = "none";
    }

    const blockW = singleBlockId ? w : w / GRID_SIZE;
    const blockH = singleBlockId ? h : h / GRID_SIZE;

    const ROWS = 15;
    const BRICKS_PER_ROW = 10;
    const brickH = blockH / ROWS;

    const startRow = singleBlockId ? singleRow : 0;
    const endRow = singleBlockId ? singleRow + 1 : GRID_SIZE;

    // Compute zoom-to-brick transform when a name is highlighted in single-block mode.
    // The target brick is scaled to (mostly) fill the canvas, centered.
    let zoomScale = 1;
    let zoomOffsetX = 0;
    let zoomOffsetY = 0;
    if (singleBlockId && highlightName) {
      const data = blocks.get(singleBlockId) ?? null;
      const cells = generateCellList(data);
      const filledSlots = getFilledSlots(data);
      const target = highlightName.trim().toLowerCase();
      let targetIndex = -1;
      for (let i = 0; i < filledSlots; i++) {
        if (cells[i].trim().toLowerCase() === target) { targetIndex = i; break; }
      }
      if (targetIndex >= 0) {
        const tRow = Math.floor(targetIndex / BRICKS_PER_ROW);
        const tCol = targetIndex % BRICKS_PER_ROW;
        const rowNames = cells.slice(tRow * BRICKS_PER_ROW, (tRow + 1) * BRICKS_PER_ROW);
        const baseFontSize = brickH * 0.7;
        ctx.font = `900 ${baseFontSize}px "Cinzel", Georgia, serif`;
        const minBrickW = baseFontSize * 0.6;
        const horizontalPadding = baseFontSize * 3.5;
        let naturalRowW = 0;
        const rawWidths = rowNames.map((n) => {
          const tw = Math.max(minBrickW, ctx.measureText(n).width + horizontalPadding);
          naturalRowW += tw;
          return tw;
        });
        const widthScale = blockW / naturalRowW;
        let xCursor = 0;
        for (let c = 0; c < tCol; c++) xCursor += rawWidths[c] * widthScale;
        const targetW = (tCol === BRICKS_PER_ROW - 1)
          ? (blockW - xCursor)
          : rawWidths[tCol] * widthScale;
        const targetH = (tRow === ROWS - 1) ? (blockH - tRow * brickH) : brickH;
        const targetX = xCursor;
        const targetY = tRow * brickH;
        const padding = 0.85; // leave a small margin so the brick doesn't kiss the frame
        zoomScale = Math.min(w / targetW, h / targetH) * padding;
        zoomOffsetX = (w - targetW * zoomScale) / 2 - targetX * zoomScale;
        zoomOffsetY = (h - targetH * zoomScale) / 2 - targetY * zoomScale;
      }
    }
    const zoomActive = zoomScale !== 1;
    if (zoomActive) {
      ctx.save();
      ctx.translate(zoomOffsetX, zoomOffsetY);
      ctx.scale(zoomScale, zoomScale);
    }

    for (let row = startRow; row < endRow; row++) {
      const startCol = singleBlockId ? singleCol : 0;
      const endCol = singleBlockId ? singleCol + 1 : GRID_SIZE;

      for (let col = startCol; col < endCol; col++) {
        const id = bid(row, col);
        const data = blocks.get(id) ?? null;
        const cells = generateCellList(data);
        const filledSlots = getFilledSlots(data);

        // Block origin on the canvas
        const bx = singleBlockId ? 0 : col * blockW;
        const by = singleBlockId ? 0 : row * blockH;

        // Source image region for this block (always relative to full portrait)
        const srcX = (col / GRID_SIZE) * img.naturalWidth;
        const srcY = (row / GRID_SIZE) * img.naturalHeight;
        const srcW = img.naturalWidth / GRID_SIZE;
        const srcH = img.naturalHeight / GRID_SIZE;

        for (let r = 0; r < ROWS; r++) {
          const rowY = by + r * brickH;
          const rowNames = cells.slice(r * BRICKS_PER_ROW, (r + 1) * BRICKS_PER_ROW);

          // Font sized relative to brick height so text fits comfortably inside
          const baseFontSize = brickH * 0.7;
          const activeFontFamily = singleBlockId ? '"Cinzel", Georgia, serif' : FONT_FAMILY;
          ctx.font = `900 ${baseFontSize}px ${activeFontFamily}`;

          const minBrickW = baseFontSize * 0.6; // floor for very short names
          const horizontalPadding = singleBlockId ? baseFontSize * 3.5 : baseFontSize * 1.8; // Generous X-axis padding
          let naturalRowW = 0;
          const rawWidths = rowNames.map((name) => {
            const tw = Math.max(minBrickW, ctx.measureText(name).width + horizontalPadding);
            naturalRowW += tw;
            return tw;
          });

          // Scale so the row perfectly fills blockW
          const scale = blockW / naturalRowW;
          const rowFontSize = baseFontSize * Math.min(scale * 1.05, 1.5);

          let currentX = bx;

          for (let c = 0; c < BRICKS_PER_ROW; c++) {
            // Force the last brick to precisely fill the remaining space to avoid float truncation gaps
            const brickW = (c === BRICKS_PER_ROW - 1)
                ? (bx + blockW - currentX)
                : rawWidths[c] * scale;
            
            // Force the last row to precisely fill the remaining height
            const drawBrickH = (r === ROWS - 1)
                ? (by + blockH - rowY)
                : brickH;
            
            const globalIndex = r * BRICKS_PER_ROW + c;
            const isFilled = globalIndex < filledSlots;
            const name = rowNames[c];

            // Map brick position geometrically across the entire 10x10 grid relative to the source image
            const absoluteBrickFracX = (col + (currentX - bx) / blockW) / GRID_SIZE;
            const absoluteBrickFracY = (row + (rowY - by) / blockH) / GRID_SIZE;
            const absoluteBrickFracW = (brickW / blockW) / GRID_SIZE;
            const absoluteBrickFracH = (drawBrickH / blockH) / GRID_SIZE;

            const srcX = absoluteBrickFracX * img.naturalWidth;
            const srcY = absoluteBrickFracY * img.naturalHeight;
            const srcW = absoluteBrickFracW * img.naturalWidth;
            const srcH = absoluteBrickFracH * img.naturalHeight;

            // Render Brick Base directly from image
            if (isFilled) {
                // Color image
                ctx.drawImage(img, srcX, srcY, srcW, srcH, currentX, rowY, brickW, drawBrickH);
            } else {
                // Grayscale image
                ctx.drawImage(grayOff, srcX, srcY, srcW, srcH, currentX, rowY, brickW, drawBrickH);
            }

            // Brick Texture — Mortar (Scaled for zoom)
            const mortarScale = singleBlockId ? 3.5 : 0.6;
            ctx.strokeStyle = isFilled ? "rgba(80, 50, 25, 0.4)" : "rgba(30, 15, 10, 0.6)";
            ctx.lineWidth = mortarScale;
            ctx.strokeRect(currentX, rowY, brickW, drawBrickH);

            // Inner highlight (top & left edge)
            ctx.beginPath();
            ctx.moveTo(currentX + mortarScale, rowY + drawBrickH - mortarScale);
            ctx.lineTo(currentX + mortarScale, rowY + mortarScale);
            ctx.lineTo(currentX + brickW - mortarScale, rowY + mortarScale);
            ctx.strokeStyle = isFilled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)";
            ctx.lineWidth = mortarScale * 1.2;
            ctx.stroke();

            // Inner shadow (bottom & right edge)
            ctx.beginPath();
            ctx.moveTo(currentX + mortarScale, rowY + drawBrickH - mortarScale);
            ctx.lineTo(currentX + brickW - mortarScale, rowY + drawBrickH - mortarScale);
            ctx.lineTo(currentX + brickW - mortarScale, rowY + mortarScale);
            ctx.strokeStyle = isFilled ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.6)";
            ctx.stroke();

            // Name text
            ctx.font = `900 ${rowFontSize}px ${activeFontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const isHighlighted = isFilled && highlightName && name.trim().toLowerCase() === highlightName.trim().toLowerCase();

            if (isHighlighted) {
              // Golden glow for highlighted name
              ctx.fillStyle = "rgba(252, 234, 187, 1)";
              ctx.shadowColor = "rgba(252, 234, 187, 0.9)";
              ctx.shadowBlur = singleBlockId ? 12 : 6;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
              // Draw a subtle highlight rectangle behind the name
              ctx.save();
              ctx.fillStyle = "rgba(201, 107, 27, 0.3)";
              ctx.fillRect(currentX + 1, rowY + 1, brickW - 2, drawBrickH - 2);
              ctx.restore();
              ctx.fillStyle = "rgba(252, 234, 187, 1)";
              ctx.shadowColor = "rgba(252, 234, 187, 0.9)";
              ctx.shadowBlur = singleBlockId ? 12 : 6;
            } else {
              ctx.fillStyle = isFilled
                ? "rgba(255, 252, 246, 0.85)"
                : "rgba(255, 248, 238, 0.22)";
              if (isFilled) {
                ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
                ctx.shadowBlur = singleBlockId ? 6 : 3;
                ctx.shadowOffsetX = singleBlockId ? 1.5 : 0.5;
                ctx.shadowOffsetY = singleBlockId ? 1.5 : 0.5;
              }
            }

            ctx.fillText(name, currentX + brickW / 2, rowY + drawBrickH / 2 + 0.5);
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;

            currentX += brickW;
          }
        }
      }
    }

    if (zoomActive) ctx.restore();

    // Block Grid Overlay (mosaic mode only)
    if (!singleBlockId) {
      ctx.strokeStyle = "rgba(208, 166, 109, 0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);

      for (let r = 1; r < GRID_SIZE; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * blockH);
        ctx.lineTo(w, r * blockH);
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(r * blockW, 0);
        ctx.lineTo(r * blockW, h);
        ctx.stroke();
      }
    }
  }, [blocks, singleBlockId, highlightName, singleRow, singleCol]);

  // Keep the first-paint callback in a ref so a new identity on every parent render
  // does NOT re-run the redraw effect (otherwise every hover move triggers a full
  // canvas redraw and blocks the main thread).
  const onFirstPaintRef = useRef(onFirstPaint);
  useEffect(() => { onFirstPaintRef.current = onFirstPaint; }, [onFirstPaint]);
  const firstPaintFiredRef = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const handle = requestAnimationFrame(() => {
      renderWall();
      if (!firstPaintFiredRef.current) {
        firstPaintFiredRef.current = true;
        onFirstPaintRef.current?.();
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [renderWall, ready]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let handle = 0;
    const ro = new ResizeObserver(() => {
      if (!ready) return;
      cancelAnimationFrame(handle);
      handle = requestAnimationFrame(() => renderWall());
    });
    ro.observe(container);
    return () => { cancelAnimationFrame(handle); ro.disconnect(); };
  }, [renderWall, ready]);

  // --- Hover / Click handlers (mosaic mode only) ---
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (singleBlockId || (!onBlockHover && !onBlockClick)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bw = rect.width / GRID_SIZE;
    const bh = rect.height / GRID_SIZE;
    const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(x / bw)));
    const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(y / bh)));
    const id = bid(row, col);
    if (id !== hoveredId) {
      setHoveredId(id);
      onBlockHover?.(id);
    }
  }, [hoveredId, singleBlockId, onBlockHover, onBlockClick]);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    onBlockHover?.(null);
  }, [onBlockHover]);

  const handleClick = useCallback(() => {
    if (hoveredId && onBlockClick) onBlockClick(hoveredId);
  }, [hoveredId, onBlockClick]);

  const hParsed = hoveredId ? parseBlockId(hoveredId) : null;
  const hRow = hParsed?.row ?? -1;
  const hCol = hParsed?.col ?? -1;
  const showHoverBox = hoveredId && !singleBlockId;

  const sParsed = selectedBlockId ? parseBlockId(selectedBlockId) : null;
  const sRow = sParsed?.row ?? -1;
  const sCol = sParsed?.col ?? -1;
  const showSelectedBox = !!selectedBlockId && !singleBlockId;

  return (
    <div
      ref={containerRef}
      className={`relative aspect-square ${className}`}
      style={{ background: "#0a0604" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ imageRendering: "auto" }}
      />

      {showSelectedBox && (
        <div
          className="absolute pointer-events-none transition-all duration-150 ease-out z-10"
          style={{
            left: `${(sCol / GRID_SIZE) * 100}%`,
            top: `${(sRow / GRID_SIZE) * 100}%`,
            width: `${100 / GRID_SIZE}%`,
            height: `${100 / GRID_SIZE}%`,
            boxShadow: "inset 0 0 0 3px rgba(252,234,187,1), 0 0 28px rgba(201,107,27,0.65)",
            background: "rgba(252, 234, 187, 0.18)",
          }}
        />
      )}

      {showHoverBox && (
        <div
          className="absolute pointer-events-none transition-all duration-100 z-20"
          style={{
            left: `${(hCol / GRID_SIZE) * 100}%`,
            top: `${(hRow / GRID_SIZE) * 100}%`,
            width: `${100 / GRID_SIZE}%`,
            height: `${100 / GRID_SIZE}%`,
            boxShadow: "inset 0 0 0 2px rgba(255,215,130,0.8), 0 0 15px rgba(201,107,27,0.4)",
            background: "rgba(255, 230, 150, 0.08)",
          }}
        />
      )}

      {!ready && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20"
          style={{ background: "rgba(10,5,2,0.6)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "rgba(220,170,90,0.8)" }}>
            Laying bricks…
          </p>
        </div>
      )}
    </div>
  );
}
