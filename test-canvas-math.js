const w = 800;
const h = 800;
const GRID_SIZE = 10;
const singleBlockId = "A1";
const singleRow = 0;
const singleCol = 0;

const blockW = singleBlockId ? w : w / GRID_SIZE;
const blockH = singleBlockId ? h : h / GRID_SIZE;

const ROWS = 15;
const BRICKS_PER_ROW = 10;
const brickH = blockH / ROWS;

console.log("blockW", blockW, "blockH", blockH, "brickH", brickH);

const startRow = singleBlockId ? singleRow : 0;
const endRow = singleBlockId ? singleRow + 1 : GRID_SIZE;
let maxX = 0;
let maxY = 0;

for (let row = startRow; row < endRow; row++) {
  const startCol = singleBlockId ? singleCol : 0;
  const endCol = singleBlockId ? singleCol + 1 : GRID_SIZE;

  for (let col = startCol; col < endCol; col++) {
    const bx = singleBlockId ? 0 : col * blockW;
    const by = singleBlockId ? 0 : row * blockH;

    for (let r = 0; r < ROWS; r++) {
      const rowY = by + r * brickH;
      let currentX = bx;

      for (let c = 0; c < BRICKS_PER_ROW; c++) {
        // Mock naturalRowW / scale
        const naturalRowW = 1000;
        const scale = blockW / naturalRowW;
        const rawWidths = Array(10).fill(100);

        const brickW = (c === BRICKS_PER_ROW - 1)
            ? (bx + blockW - currentX)
            : rawWidths[c] * scale;
        
        const drawBrickH = (r === ROWS - 1)
            ? (by + blockH - rowY)
            : brickH;

        if (currentX + brickW > maxX) maxX = currentX + brickW;
        if (rowY + drawBrickH > maxY) maxY = rowY + drawBrickH;

        currentX += brickW;
      }
    }
  }
}

console.log("maxX", maxX, "maxY", maxY);
