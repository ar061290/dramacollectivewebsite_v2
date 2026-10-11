// Uniform grid over the viewport for nearest-star lookups along the cursor path.

export class SpatialGrid {
  constructor(cellSize) {
    this.cell = cellSize;
    this.cols = 0;
    this.rows = 0;
    this.buckets = [];
  }

  build(items, width, height) {
    this.cols = Math.max(1, Math.ceil(width / this.cell));
    this.rows = Math.max(1, Math.ceil(height / this.cell));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    for (const it of items) {
      const c = Math.min(this.cols - 1, Math.max(0, Math.floor(it.x / this.cell)));
      const r = Math.min(this.rows - 1, Math.max(0, Math.floor(it.y / this.cell)));
      this.buckets[r * this.cols + c].push(it);
    }
  }

  /** Call fn(item) for every item in cells overlapping the rectangle. */
  query(minX, minY, maxX, maxY, fn) {
    const c0 = Math.max(0, Math.floor(minX / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor(maxX / this.cell));
    const r0 = Math.max(0, Math.floor(minY / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor(maxY / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets[r * this.cols + c];
        for (let i = 0; i < b.length; i++) fn(b[i]);
      }
    }
  }
}
