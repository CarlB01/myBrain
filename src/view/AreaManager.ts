import { Node } from "../data/Node.js";
import { debounce, Debouncer } from "obsidian";
import { DrawingUtils } from "../utils/DrawingUtils.js";
import { RV } from "../utils/constants.js";
import MyBrainPlugin from "../main.js";

import { NodeRenderer } from "./NodeRenderer.js";
import { LayoutGeometry } from "./LayoutGeometry.js";
import { GroupToggleManager } from "./GroupToggleManager.js";
import { PopupManager } from "./PopupManager.js";
import { HoverHighlightManager } from "./HoverHighlightManager.js";
import { NetworkGraph } from "../data/NetworkGraph.js";
import { Gate } from "../data/Gate.js";

type QuadrantName = "center" | "upper" | "left" | "lower" | "right";

export class AreaManager {
  containerEl: HTMLElement;
  backContainerSVG!: SVGSVGElement;
  center!: HTMLElement;
  left!: HTMLElement;
  right!: HTMLElement;
  upper!: HTMLElement;
  lower!: HTMLElement;

  private graph: NetworkGraph;
  private plugin: MyBrainPlugin;
  
  public linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();
  private animationFrameId: number | null = null;
  private redrawQueued = false;
  private debouncedRender: Debouncer<[], void>;
  private resizeObserver: ResizeObserver | null = null;

  private toggleManager: GroupToggleManager;
  private popupManager: PopupManager;
  private hoverManager: HoverHighlightManager;

  private nodeElByPath = new Map<string, HTMLElement>();
  
  private readonly cornerEpsilon = 6;

  constructor(graph: NetworkGraph, parentEl: HTMLElement, plugin: MyBrainPlugin) {
    this.graph = graph;
    this.containerEl = parentEl;
    this.plugin = plugin;

    this.toggleManager = new GroupToggleManager(this.containerEl, () => {
      this.reflowArea(this.upper, "upper");
      this.reflowArea(this.left, "left");
      this.reflowArea(this.lower, "lower");
      this.reflowArea(this.right, "right");
      this.requestRedraw();
    });

    this.popupManager = new PopupManager(this.containerEl, this.plugin);
    this.hoverManager = new HoverHighlightManager(this.containerEl, this.linkCache, this.nodeElByPath);

    this.debouncedRender = debounce(this.executeRenderGraph.bind(this), 40, true);
  }

  // #region PUBLIC METHODS
  public initiate() {
    this.containerEl.addClass(RV.CONTAINER);
    
    this.toggleManager.setup();
    this.hoverManager.setup();

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      if (!this.graph?.centerNote) return;

      if (!this.center?.isConnected) {
        this.renderGraph();
      } else {
        this.requestRedraw();
      }
    });

    this.resizeObserver.observe(this.containerEl);

    // Fanger scroll i alle kvadranter (capture: true fordi scroll-events ikke bobler)
    this.plugin.registerDomEvent(
      this.containerEl,
      "scroll",
      () => this.requestRedraw(),
      { capture: true, passive: true }
    );
  }

  public destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
      this.redrawQueued = false;
      this.animationFrameId = null;
      if (!this.containerEl || !this.containerEl.isConnected) return;
      
      const rect = this.containerEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      if (this.graph?.centerNote) this.drawAllGraphLines();
    });
  }

  public renderGraph(): void {
    if (this.plugin.isAppPaused()) return;
    if (this.containerEl.isConnected && (this.containerEl.clientWidth === 0 || this.containerEl.clientHeight === 0)) {
      return;
    }
    this.debouncedRender();
  }

  public cancelPendingRedraw() {
    this.debouncedRender.cancel();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.redrawQueued = false;
  }

  public clearTransientHoverState(): void {
    this.hoverManager.clearHoverHighlight();
  }
  // #endregion

  // #region GRAPH RENDER & LAYOUT ENGINE
  private executeRenderGraph(): void {  
    const centerNote = this.graph.centerNote;
    if (!centerNote || !this.containerEl?.isConnected) return;

    if (this.containerEl.clientWidth === 0 || this.containerEl.clientHeight === 0) return;

    this.containerEl.empty();
    this.containerEl.className = "view-content rv-container";

    const fragment = createFragment();

    this.center = fragment.createDiv({ cls: RV.AREA_CENTER });
    this.left = fragment.createDiv({ cls: RV.AREA_LEFT });
    this.right = fragment.createDiv({ cls: RV.AREA_RIGHT });
    this.upper = fragment.createDiv({ cls: RV.AREA_TOP });
    this.lower = fragment.createDiv({ cls: RV.AREA_BOTTOM });
    this.backContainerSVG = fragment.createSvg("svg", { cls: RV.SVG_LAYER });

    // 0. Center
    this.renderQuadrant(this.center, [[centerNote]], "center");
    this.popupManager.renderInfoBtnForCenterNode(this.graph);
    if (centerNote.div) this.nodeElByPath.set(centerNote.path, centerNote.div);

    // 1. Upper (Parents)
    const cleanParents = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent");
    this.renderQuadrant(this.upper, [this.graph.getSortedNotesForQuadrant(cleanParents, false)], "upper");

    // 2. Left (Friends)
    const cleanFriends = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend");
    this.containerEl.toggleClass("rv-no-left", cleanFriends.length === 0);
    this.renderQuadrant(this.left, [this.graph.getSortedNotesForQuadrant(cleanFriends, false)], "left");

    // 3. Lower (Children + Loose children)
    const allUsedNotes = Array.from(this.graph.noteCache.values()).filter(n => n.isUsed);
    const children = this.graph.getSortedNotesForQuadrant(allUsedNotes.filter(n => n.relation === "child"), false);
    const looseChildren = this.graph.getSortedNotesForQuadrant(allUsedNotes.filter(n => n.relation === "undefined"), false);
    this.renderQuadrant(this.lower, [children, looseChildren].filter(c => c.length > 0), "lower");

    // 4. Right (Siblings + Loose siblings)
    const siblings = this.graph.getSortedNotesForQuadrant(allUsedNotes.filter(n => n.relation === "sibling"), true);
    const looseSiblings = this.graph.getSortedNotesForQuadrant(allUsedNotes.filter(n => n.relation === "undefined-sibling"), true);
    this.renderQuadrant(this.right, [siblings, looseSiblings].filter(c => c.length > 0), "right");

    this.containerEl.appendChild(fragment);
    this.drawAllGraphLines(); 
  }

  private renderQuadrant(area: HTMLElement, collections: Node[][], areaName: QuadrantName) {
    area.empty(); 
    const totalNoteCount = collections.reduce((sum, col) => sum + col.length, 0);
    if (totalNoteCount === 0) return;

    const areaFragment = createFragment();
    const collectionWrapper = areaFragment.createDiv({ cls: RV.COLLECTION_WRAPPER });
    const columnHost = this.resolveColumnHost(collectionWrapper, areaName);

    const items = this.buildAreaItems(area, collections, totalNoteCount);
    this.distributeItemsIntoColumns(columnHost, items, areaName);

    area.appendChild(areaFragment);
  }

  private resolveColumnHost(collectionWrapper: HTMLElement, areaName: QuadrantName): HTMLElement {
    if (areaName === "lower" || areaName === "right") {
      return collectionWrapper;
    }
    const collectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });
    return collectionDiv.createDiv({ cls: RV.COL_WRAPPER });
  }

  private buildAreaItems(area: HTMLElement, collections: Node[][], totalNoteCount: number): HTMLElement[] {
    const items: HTMLElement[] = [];
    const isCenter = area === this.center;

    collections.forEach((collection, collectionIdx) => {
      if (collection.length === 0) return;

      const groupedData = this.graph.groupByFirstTag(collection);
      let isFirstInCollection = true;

      for (const group of groupedData) {
        const isCollapsible = group.notes.length > 4 && totalNoteCount > 20;

        group.notes.forEach((node, index) => {
          const noteEl = NodeRenderer.renderNodeElement(node, area, isCenter, this.plugin.sclBridge);

          if (collectionIdx > 0 && isFirstInCollection) {
            noteEl.addClass("rv-collection-start");
            isFirstInCollection = false;
          }

          if (isCollapsible && index > 0 && this.plugin.settings.groupsCollapsed) {
            noteEl.classList.add("hidden");
          }

          if (node.div) {
            this.nodeElByPath.set(node.path, node.div);
          }

          items.push(noteEl);
        });

        if (isCollapsible) {
          const firstDiv = group.notes[0]?.div;
          if (firstDiv) {
            firstDiv.classList.add("rv-first-in-group");
            firstDiv.prepend(this.toggleManager.buildPlusMinusBtn(firstDiv, group, true));
          }
        }
      }
    });

    return items;
  }
  
  public reflowArea(areaEl: HTMLElement, areaName: QuadrantName): void {
    const collectionWrapper = areaEl.querySelector<HTMLElement>(`.${RV.COLLECTION_WRAPPER}`);
    if (!collectionWrapper) return;

    const columnHost = areaName === "lower" || areaName === "right"
      ? collectionWrapper
      : collectionWrapper.querySelector<HTMLElement>(`.${RV.COL_WRAPPER}`) ?? collectionWrapper;

    const items = Array.from(columnHost.querySelectorAll<HTMLElement>(".item"));
    if (items.length === 0) return;

    this.distributeItemsIntoColumns(columnHost, items, areaName);
  }

  private distributeItemsIntoColumns(columnHost: HTMLElement, items: HTMLElement[], areaName: QuadrantName): void {
    const visibleCount = items.reduce((count, el) => count + (el.classList.contains("hidden") ? 0 : 1), 0);
    const colCount = this.getColumnCount(areaName, visibleCount);

    if (areaName === "lower") {
      columnHost.toggleClass("is-scrolling", visibleCount > 24);
    }

    const columns: HTMLElement[] = [];
    for (let i = 0; i < colCount; i++) {
      columns.push(createDiv({ cls: "rv-flex-col" }));
    }

    const firstCol = columns[0];
    if (!firstCol) return;

    const perCol = Math.max(1, Math.ceil(visibleCount / colCount));
    let visibleIdx = 0;
    let currentCol: HTMLElement = firstCol;

    for (const item of items) {
      if (!item.classList.contains("hidden")) {
        const colIndex = Math.min(Math.floor(visibleIdx / perCol), colCount - 1);
        currentCol = columns[colIndex] ?? firstCol;
        visibleIdx++;
      }
      currentCol.appendChild(item);
    }

    columnHost.querySelectorAll(".rv-flex-col").forEach(col => col.remove());
    for (const col of columns) {
      columnHost.appendChild(col);
    }
  }

  private getColumnCount(areaName: QuadrantName, visibleCount: number): number {
    switch (areaName) {
      case "center":
        return 1;
      case "upper":
      case "left":
        return visibleCount > 6 ? 2 : 1;
      case "lower":
        if (visibleCount <= 1) return 1;
        if (visibleCount <= 6) return 2;
        if (visibleCount <= 12) return 3;
        if (visibleCount <= 24) return 4;
        return Math.ceil(visibleCount / 6);
      case "right":
        return Math.max(1, Math.ceil(visibleCount / 5));
    }
  }
  // #endregion

  // #region GRAPH LINES
  private drawAllGraphLines() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;
    this.nodeElByPath.clear();
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

    const canDraw = (from: Gate, to: Gate) => {
      if (!from?.svg || !to?.svg || !from.parentNote.div || !to.parentNote.div) return false;
      const rA = from.svg.getBoundingClientRect();
      const rB = to.svg.getBoundingClientRect();
      if (LayoutGeometry.isBadGateRect(rA, this.cornerEpsilon) || LayoutGeometry.isBadGateRect(rB, this.cornerEpsilon)) return false;

      const vA = viewports[from.parentNote.assignedArea];
      if (vA && (rA.bottom < vA.top || rA.top > vA.bottom || rA.right < vA.left || rA.left > vA.right)) return false;
      
      const vB = viewports[to.parentNote.assignedArea];
      if (vB && (rB.bottom < vB.top || rB.top > vB.bottom || rB.right < vB.left || rB.left > vB.right)) return false;

      return true;
    };

    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i]; if (!nodeA) continue;
      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j]; if (!nodeB) continue;

        const isLoose = nodeA.isLooseRelation || nodeB.isLooseRelation;

        // RULE 1: A -> B (child)
        if (nodeA.relations.children.has(nodeB) || nodeB.relations.parents.has(nodeA)) {
          if (canDraw(nodeA.lowerGate, nodeB.upperGate)) {
            const sc = getColor(nodeB); DrawingUtils.drawLink(nodeA.lowerGate, nodeB.upperGate, links, offBy, canvas, sc, isLoose);
            nodeA.lowerGate.svg!.classList.add('is-connected'); nodeB.upperGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeB.upperGate, colorful ? sc : null);
          }
        }
        // RULE 2: B -> A (child)
        else if (nodeB.relations.children.has(nodeA) || nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeB.lowerGate, nodeA.upperGate)) {
            const sc = getColor(nodeA); DrawingUtils.drawLink(nodeB.lowerGate, nodeA.upperGate, links, offBy, canvas, sc, isLoose);
            nodeB.lowerGate.svg!.classList.add('is-connected'); nodeA.upperGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeA.upperGate, colorful ? sc : null);
          }
        }
        // RULE 3: friend
        else if (nodeA.relations.friends.has(nodeB) || nodeB.relations.friends.has(nodeA)) {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            const sc = getColor(nodeB); DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas, sc, isLoose);
            nodeA.friendGate.svg!.classList.add('is-connected'); nodeB.friendGate.svg!.classList.add('is-connected');
            this.applyGateColor(nodeB.friendGate, colorful ? sc : null);
          }
        }
      }
    }

    for (const [key, link] of this.linkCache.entries()) {
      if (!link.used) { link.svgElement.remove(); this.linkCache.delete(key); }
    }
  }

  private getLandingNodeColor(note: Node, colorful: boolean): string | null {
    if (!colorful || note.sclColor.length === 0) return null;
    return note.sclColor;
  }

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
  // #endregion
}
