export interface CachedLink {
  svgElement: SVGPathElement;
  used: boolean;
}

export class HoverHighlightManager {
  private containerEl: HTMLElement;
  private linkCache: Map<string, CachedLink>;
  private nodeElByPath: Map<string, HTMLElement>;

  private hoverBound: boolean = false;
  private activeHoverPath: string | null = null;
  private hoverNeighborEls: Set<HTMLElement> = new Set();

  constructor(
    containerEl: HTMLElement,
    linkCache: Map<string, CachedLink>,
    nodeElByPath: Map<string, HTMLElement>
  ) {
    this.containerEl = containerEl;
    this.linkCache = linkCache;
    this.nodeElByPath = nodeElByPath;
  }

  /**
   * Binds mouse telemetry event listeners natively using Obsidian's internal delegation layers.
   * Leverages structural layout gates to capture rapid cursor movement thresholds efficiently.
   */
  public setup(): void {
    if (this.hoverBound) {
      return;
    }
    this.hoverBound = true;

    // Explicit type-guards assigned on the boundary handler parameters
    this.containerEl.on("mouseover", ".item", (_e: MouseEvent, target: HTMLElement | null) => {
      if (!target) return;
      
      const np: string | null = target.getAttribute("data-note-path");
      if (np !== null && this.activeHoverPath !== np) {
        this.applyHoverHighlight(np);
      }
    });

    this.containerEl.on("mouseout", ".item", () => {
      this.clearHoverHighlight();
    });
  }

  /**
   * Applies layout hover highlights to focused links and maps out direct neighbors in real-time.
   * Utilizes type-safe composite tracking keys to guarantee consistent array evaluations.
   * 
   * @param notePath The absolute file reference tracking route for the targeted node context.
   */
  public applyHoverHighlight(notePath: string): void {
    this.clearHoverHighlight();
    this.activeHoverPath = notePath;

    for (const [lineId, cacheItem] of this.linkCache.entries()) {
      const parsed: [string, string] | null = this.parseLineId(lineId);
      if (!parsed) {
        continue;
      }
      
      const [a, b] = parsed;
      if (a !== notePath && b !== notePath) {
        continue;
      }

      cacheItem.svgElement.classList.add("is-hover-link");
      
      const neighborPath: string = a === notePath ? b : a;
      const neighborEl: HTMLElement | null = this.nodeElByPath.get(neighborPath) ?? null;
      
      if (neighborEl !== null) {
        neighborEl.classList.add("is-hover-neighbor");
        this.hoverNeighborEls.add(neighborEl);
      }
    }
  }

  /**
   * Synchronously clears all active visual highlights with zero memory heap allocations.
   * Prevents runtime layout thrashing by operating directly on referenced node instances.
   */
  public clearHoverHighlight(): void {
    this.activeHoverPath = null;

    // Zero-allocation loop: iterates directly on the MapIterator without cloning arrays onto the heap
    for (const item of this.linkCache.values()) {
      item.svgElement.classList.remove("is-hover-link");
    }

    // Set.prototype.forEach executes in-place without triggering unneeded object mutations
    this.hoverNeighborEls.forEach((el: HTMLElement) => {
      el.classList.remove("is-hover-neighbor");
    });
    this.hoverNeighborEls.clear();
  }

  /**
   * Extracts structural node IDs from the composite SVG path line identifiers.
   * Ensures string slices map exhaustively into tuple formats with no partial states.
   * 
   * @param lineId The unified string mapping tracking coordinates between node structures.
   * @returns A strict tuple array containing the isolated source/target strings, or null.
   */
  private parseLineId(lineId: string): [string, string] | null {
    const idx: number = lineId.indexOf("->");
    if (idx <= 0 || idx >= lineId.length - 2) {
      return null;
    }
    const a: string = lineId.slice(0, idx);
    const b: string = lineId.slice(idx + 2);
    
    return (!a || !b) ? null : [a, b];
  }
}
