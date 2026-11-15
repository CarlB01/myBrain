import { NetworkGraph } from "../NetworkGraph.js";
import { Node } from "../Node.js";
import { debounce, Debouncer } from "obsidian";
import { DrawingUtils } from "../DrawingUtils.js";
import { Gate } from "../Gate.js";
import { RV } from "../constants.js";
import MyBrainPlugin from "../main.js";

// Import our modular sub-managers from the view sub-folder layout
import { NodeRenderer } from "./NodeRenderer.js";
import { LayoutGeometry } from "./LayoutGeometry.js";
import { GroupToggleManager } from "./GroupToggleManager.js";
import { PopupManager } from "./PopupManager.js";
import { HoverHighlightManager } from "./HoverHighlightManager.js";

export class AreaManager {
  containerEl: HTMLElement;
  backContainerSVG!: SVGSVGElement;
  center!: HTMLElement; left!: HTMLElement; right!: HTMLElement; upper!: HTMLElement; lower!: HTMLElement;

  private graph: NetworkGraph;
  private plugin: MyBrainPlugin;
  
  public linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();
  private animationFrameId: number | null = null;
  private redrawQueued = false;
  private debouncedRender: Debouncer<[], void>;

  // Sub-managers declared with explicit types
  private toggleManager: GroupToggleManager;
  private popupManager: PopupManager;
  private hoverManager: HoverHighlightManager;

  private nodeElByPath = new Map<string, HTMLElement>();
  
  private delegatedHandlersBound = false;
  private boundClickHandler: ((event: MouseEvent) => void) | null = null;
  private geometryRetryCount = 0;
  private readonly maxGeometryRetries = 8;
  private pendingInvalidLinks = false;
  private readonly cornerEpsilon = 6;

  constructor(graph: NetworkGraph, parentEl: HTMLElement, plugin: MyBrainPlugin) {
    this.graph = graph;
    this.containerEl = parentEl;
    this.plugin = plugin;

    // Guaranteed initialization inside the constructor to satisfy TypeScript compiler rules
    this.toggleManager = new GroupToggleManager(this.containerEl, this.requestRedraw.bind(this));
    this.popupManager = new PopupManager(this.containerEl, this.plugin);
    this.hoverManager = new HoverHighlightManager(this.containerEl, this.linkCache, this.nodeElByPath);

    this.debouncedRender = debounce(this.executeRenderGraph.bind(this), 40, true);
  }

  // #region PUBLIC METHODS
  public initiate() {
    this.containerEl.addClass(RV.CONTAINER);
    
    // Bind click delegation for group collapse/expand triggers
    const res = this.toggleManager.setup(this.delegatedHandlersBound);
    this.boundClickHandler = res.handler;
    this.delegatedHandlersBound = res.bound;
    
    // Bind hover tracking for line highlighting
    this.hoverManager.setup();
  }

  public destroy() {
    this.debouncedRender.cancel();
    this.cancelPendingRedraw(); 
    this.linkCache.clear();
    this.popupManager.cleanupPopup(); 
    this.toggleManager.teardown();
  }

  public requestRedraw() {
    if (this.redrawQueued) return;
    this.redrawQueued = true;

    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = window.requestAnimationFrame(() => {
        this.redrawQueued = false; this.animationFrameId = null;
        if (!this.containerEl || !this.containerEl.isConnected) return;
        
        const rect = this.containerEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        LayoutGeometry.allocateAreaHeights(this.containerEl, this.center, this.upper, this.left, this.lower);
        LayoutGeometry.yieldIfLeftTall(this.containerEl, this.center);
        LayoutGeometry.yieldIfRightTall(this.containerEl, this.center, this.upper);
        
        if (this.graph?.centerNote) this.drawAllGraphLines();
      });
    });
  }

  public renderGraph(): void {
    if (this.plugin.isAppPaused()) return;
    this.debouncedRender();
  }

  public cancelPendingRedraw() {
    this.debouncedRender.cancel();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.redrawQueued = false; this.geometryRetryCount = 0; this.pendingInvalidLinks = false;
  }
  // #endregion

  // #region GRAPH METHODS
  private executeRenderGraph(): void {  
    const centerNote = this.graph.centerNote;
    if (!centerNote || !this.containerEl?.isConnected) return;

    this.containerEl.empty();
    this.containerEl.className = "view-content rv-container is-calculating";

    const fragment = createFragment();
    this.containerEl.setAttribute(RV.LEFT_TALL, 'false');
    this.containerEl.setAttribute(RV.RIGHT_TALL, 'false');

    this.center = fragment.createDiv({ cls: RV.AREA_CENTER });
    this.left = fragment.createDiv({ cls: RV.AREA_LEFT });
    this.right = fragment.createDiv({ cls: RV.AREA_RIGHT });
    this.upper = fragment.createDiv({ cls: RV.AREA_TOP });
    this.lower = fragment.createDiv({ cls: RV.AREA_BOTTOM });
    this.backContainerSVG = fragment.createSvg("svg", { cls: RV.SVG_LAYER });

    // 0. Render Center Quad
    this.renderQuadrant(this.center, [[centerNote]], "center");
    this.popupManager.renderInfoBtnForCenterNode(this.graph);

    if (centerNote.div) this.nodeElByPath.set(centerNote.path, centerNote.div);

    // 1. Render Upper Quad
    const cleanParentsOnly = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent");
    this.renderQuadrant(this.upper, [this.graph.getSortedNotesForQuadrant(cleanParentsOnly, false)], "upper");

    // 2. Render Left Quad
    const cleanFriendsOnly = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend");
    this.renderQuadrant(this.left, [this.graph.getSortedNotesForQuadrant(cleanFriendsOnly, false)], "left");

    // 3. Render Lower Quad
    const allNotesInCache = Array.from(this.graph.noteCache.values()).filter(n => n.isUsed);
    const childrenOnly = this.graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "child"), false);
    const totalUndefinedBucket = this.graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "undefined"), false);
    this.renderQuadrant(this.lower, [childrenOnly, totalUndefinedBucket].filter(c => c.length > 0), "lower");

    // 4. Render Right Quad
    const siblings = this.graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "sibling"), true);
    const undefinedSiblings = this.graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "undefined-sibling"), true);
    this.renderQuadrant(this.right, [siblings, undefinedSiblings].filter(c => c.length > 0), "right");

    this.containerEl.appendChild(fragment);
    this.setupScrollEventListeners();
    
    LayoutGeometry.allocateAreaHeights(this.containerEl, this.center, this.upper, this.left, this.lower);
    LayoutGeometry.yieldIfLeftTall(this.containerEl, this.center);
    LayoutGeometry.yieldIfRightTall(this.containerEl, this.center, this.upper);
    
    this.drawAllGraphLines(); 

    window.requestAnimationFrame(() => this.containerEl.classList.remove('is-calculating'));
  }

  private renderQuadrant(area: HTMLElement, collections: Node[][], areaName: string) {
    area.empty(); 
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    const areaFragment = createFragment();
    const collectionWrapper = areaFragment.createDiv(RV.COLLECTION_WRAPPER);

    collections.forEach(collection => {
      if (collection.length === 0) return;
      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV.COL_WRAPPER });
      
      if (collection.length >= 2 && collection.length <= 6) colWrapDiv.addClass('rv-2-6-items-group');
      if (collection.length === 1) colWrapDiv.addClass('rv-single-item-group');
    
      const tagGroupedNotes = this.graph.groupByFirstTag(collection);
      this.renderGroupCollection(colWrapDiv, tagGroupedNotes, noteCount);
    });
    area.appendChild(areaFragment);
  }

  private renderGroupCollection(targetContainer: HTMLElement, groupedData: { tag: string; notes: Node[] }[], totalNoteCount: number) {
    groupedData.forEach(group => {
      const groupDiv = targetContainer.createDiv({ cls: RV.GROUPS });
      const overGrensen = group.notes.length > 4 && totalNoteCount > 20;

      group.notes.forEach((node, index) => {
        const noteEl = NodeRenderer.renderNodeElement(node, targetContainer, this.center === targetContainer);
        if (overGrensen && index > 0 && this.plugin.settings.groupsCollapsed) noteEl.classList.add('hidden');
        groupDiv.appendChild(noteEl);
        if (node.div) this.nodeElByPath.set(node.path, node.div);
      });

      if (overGrensen) {
        const firstDiv = group.notes[0]?.div;
        if (firstDiv) {
          firstDiv.classList.add('rv-first-in-group');
          firstDiv.prepend(this.toggleManager.buildPlusMinusBtn(firstDiv, group, true));
        }
      }
    });
  }

  private drawAllGraphLines() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;
    this.pendingInvalidLinks = false; this.nodeElByPath.clear();
    const offBy = LayoutGeometry.offBy(this.containerEl);
    if (!offBy) return;
    
    const links = this.linkCache; const canvas = this.backContainerSVG;
    const colorful = this.plugin.settings.colorful === true;
    const colorCache = new Map<Node, string | null>();

    const getColor = (n: Node): string | null => {
      if (colorCache.has(n)) return colorCache.get(n)!;
      const c = this.getLandingNodeColor(n, colorful);
      colorCache.set(n, c); return c;
    };

    const visibleNotes = Array.from(this.graph.noteCache.values()).filter(n => n.isUsed && n.assignedArea !== "ignored");
        for (const n of visibleNotes) if (n.div) this.nodeElByPath.set(n.path, n.div);
    for (const link of links.values()) link.used = false;

    for (const note of visibleNotes) {
      note.upperGate.svg?.classList.remove('is-connected');
      note.lowerGate.svg?.classList.remove('is-connected');
      note.friendGate.svg?.classList.remove('is-connected');
      this.applyGateColor(note.upperGate, null); this.applyGateColor(note.lowerGate, null); this.applyGateColor(note.friendGate, null);
    }

    const viewports = {
      center: this.center?.getBoundingClientRect() ?? null, upper: this.upper?.getBoundingClientRect() ?? null,
      lower: this.lower?.getBoundingClientRect() ?? null, left: this.left?.getBoundingClientRect() ?? null, right: this.right?.getBoundingClientRect() ?? null, ignored: null
    };

    // ==========================================================================
    // 🔍 HIGH-VELOCITY GEOMETRIC INTERSECTION LOG & GUARD
    // Evaluation layer verifying if port connectors reside inside their active frames.
    // ==========================================================================
    const canDraw = (from: Gate, to: Gate) => {
      if (!from?.svg || !to?.svg || !from.parentNote.div || !to.parentNote.div) return false;
      const rA = from.svg.getBoundingClientRect(); const rB = to.svg.getBoundingClientRect();
      if (LayoutGeometry.isBadGateRect(rA, this.cornerEpsilon) || LayoutGeometry.isBadGateRect(rB, this.cornerEpsilon)) return false;

      // Extract pre-computed DOMRect viewport mask for the source node quadrant in O(1)
      const vA = viewports[from.parentNote.assignedArea];
      if (vA && (rA.bottom < vA.top || rA.top > vA.bottom)) return false;
      
      // Extract pre-computed DOMRect viewport mask for the target node quadrant in O(1)
      const vB = viewports[to.parentNote.assignedArea];
      if (vB && (rB.bottom < vB.top || rB.top > vB.bottom)) return false;
      return true;
    };

    // ==========================================================================
    // 2. THE GEOMETRICAL VECTOR RENDERING TRACE (Strictly 3 clean rules)
    // ==========================================================================
    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i]; if (!nodeA) continue;
      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j]; if (!nodeB) continue;

        // RULE 1: A -> B (child)
        if (nodeA.relations.children.has(nodeB) || nodeB.relations.parents.has(nodeA)) {
          if (canDraw(nodeA.lowerGate, nodeB.upperGate)) {
            const sc = getColor(nodeB); DrawingUtils.drawLink(nodeA.lowerGate, nodeB.upperGate, links, offBy, canvas, sc);
            nodeA.lowerGate.svg!.classList.add('is-connected'); nodeB.upperGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeB.upperGate, colorful ? sc : null);
          } else this.pendingInvalidLinks = true;
        }
        // RULE 2: B -> A (child)
        else if (nodeB.relations.children.has(nodeA) || nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeB.lowerGate, nodeA.upperGate)) {
            const sc = getColor(nodeA); DrawingUtils.drawLink(nodeB.lowerGate, nodeA.upperGate, links, offBy, canvas, sc);
            nodeB.lowerGate.svg!.classList.add('is-connected'); nodeA.upperGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeA.upperGate, colorful ? sc : null);
          } else this.pendingInvalidLinks = true;
        }
        // RULE 3: friend
        else if (nodeA.relations.friends.has(nodeB) || nodeB.relations.friends.has(nodeA)) {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            const sc = getColor(nodeB); DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas, sc);
            nodeA.friendGate.svg!.classList.add('is-connected'); nodeB.friendGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeB.friendGate, colorful ? sc : null);
          } else this.pendingInvalidLinks = true;
        }
      }
    }

    // 3. GARBAGE COLLECTION HARVESTING: Purges dead bezier paths from the HTML DOM tree
    for (const [key, link] of this.linkCache.entries()) {
      if (!link.used) { link.svgElement.remove(); this.linkCache.delete(key); }
    }

    // Deterministic recovery pass:
    // If some links were skipped due to unstable/invalid gate geometry, schedule another redraw
    if (this.pendingInvalidLinks && this.geometryRetryCount < this.maxGeometryRetries) {
      this.geometryRetryCount++; this.requestRedraw();
    } else this.geometryRetryCount = 0;
  }

  private setupScrollEventListeners() {
    [this.upper, this.lower, this.left, this.right].forEach(area => {
      const sw = area?.querySelector(`.${RV.COLLECTION_WRAPPER}`) as HTMLElement;
      if (sw) this.plugin.registerDomEvent(sw, 'scroll', () => this.requestRedraw(), { passive: true });
    });
  }

  /**
   * Resolves display color from node link text using an optimized tiered lookup.
   * Prioritizes high-velocity raw inline styles from Re-Supercharged Links (SCL) 
   * to prevent layout thrashing, falling back to computed styles for legacy engines.
   * 
   * @param note The network node instance to harvest styles from.
   * @param colorful Configuration flag indicating whether custom node coloring is active.
   * @returns The extracted color string profile, or null if no custom style matches.
   */
  private getLandingNodeColor(note: Node, colorful: boolean): string | null {
    if (!colorful || !note.div) return null;

    const linkEl: HTMLElement | null = note.div.querySelector(".data-link-text") as HTMLElement | null;
    if (!linkEl) return null;

    // 1. Primary High-Velocity Path: Direct memory lookup of SCL injected inline-styles
    const inlineColor: string = linkEl.style.color;
    if (inlineColor && inlineColor.trim().length > 0) {
      return inlineColor;
    }

    // 2. Secondary Fallback Path: Compute heavy style cascade matrices for legacy CSS engines
    const computed: CSSStyleDeclaration = window.getComputedStyle(linkEl);
    const computedColor: string = computed.color;

    return computedColor && computedColor.trim().length > 0 ? computedColor : null;
  }

  /**
   * Applies or removes gate color override with minimal DOM writes.
   */
  private applyGateColor(gate: Gate, color: string | null): void {
    const circle = gate.svg?.querySelector("circle") as SVGCircleElement | null;
    if (!circle) return;
    if (color === null) {
      if (circle.style.fill.length > 0) circle.style.removeProperty("fill");
      if (circle.style.stroke.length > 0) circle.style.removeProperty("stroke");
      return;
    }
    if (circle.style.fill !== color) circle.style.fill = color;
    if (circle.style.stroke !== color) circle.style.stroke = color;
  }

  public clearTransientHoverState() { 
    this.hoverManager.clearHoverHighlight(); 
  }
  // #endregion
}
