/**
 * Binary search font fitter.
 * Finds the largest font size where text fits, then stretches
 * line-height so it overflows slightly — overflow:hidden clips
 * cleanly, leaving zero gap at the bottom.
 */
export function binaryFitFontSize(
  el: HTMLElement,
  lo: number = 0.5,
  hi: number = 20,
  iterations: number = 18,
): number {
  el.style.lineHeight = "1";
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    void el.offsetHeight; // force reflow
    if (el.scrollHeight > el.clientHeight) hi = mid;
    else lo = mid;
  }
  el.style.fontSize = `${lo}px`;
  void el.offsetHeight;
  const stretch = el.clientHeight / el.scrollHeight;
  el.style.lineHeight = String(stretch * 1.02);
  return lo;
}

/**
 * rAF-batched queue — processes N blocks per frame to avoid layout thrashing.
 */
export class FontFitQueue {
  private queue: HTMLElement[] = [];
  private running = false;
  private batchSize = 4;
  private resolvers: (() => void)[] = [];
  private scheduled = new Set<HTMLElement>();

  schedule(el: HTMLElement) {
    if (this.scheduled.has(el)) return;
    this.scheduled.add(el);
    this.queue.push(el);
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.drain());
    }
  }

  private drain() {
    let count = 0;
    while (this.queue.length && count < this.batchSize) {
      const el = this.queue.shift()!;
      this.scheduled.delete(el);
      if (el.isConnected) binaryFitFontSize(el, 0.5, 20, 16);
      count++;
    }
    if (this.queue.length) requestAnimationFrame(() => this.drain());
    else {
      this.running = false;
      this.resolvers.forEach((r) => r());
      this.resolvers = [];
    }
  }

  waitUntilDone(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.resolvers.push(r));
  }
}

// Singleton
export const fontFitQueue = new FontFitQueue();
