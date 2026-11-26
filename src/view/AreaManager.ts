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
import { SclBridge } from "../scl-bridge.js";

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
      this.reflowHorizontalArea(this.lower, true);
      this.reflowHorizontalArea(this.right, false);
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
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Ignorer 0x0 når vinduet er skjult/i dvale på macOS
        if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      }
      if (this.graph?.centerNote) {
        // Hvis grafen ble tømt eller mangler innhold etter dvale, bygg på nytt; ellers bare oppdater linjer
        if (!this.center?.isConnected) {
          this.renderGraph();
        } else {
          this.requestRedraw();
        }
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
    // Ikke start ny DOM-bygging hvis vinduet er skjult/occluded på macOS
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
  // #endregion

  // #region GRAPH METHODS
  private executeRenderGraph(): void {  
    const centerNote = this.graph.centerNote;
    if (!centerNote || !this.containerEl?.isConnected) return;

    // Dobbeltsjekk dimensjoner før vi tømmer DOM-en (hindrer blank skjerm etter Mac-dvale)
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

    // 0. Render Center Quad
    this.renderQuadrant(this.center, [[centerNote]], "center");
    this.popupManager.renderInfoBtnForCenterNode(this.graph);

    if (centerNote.div) this.nodeElByPath.set(centerNote.path, centerNote.div);

    // 1. Render Upper Quad
    const cleanParentsOnly = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent");
    this.renderQuadrant(this.upper, [this.graph.getSortedNotesForQuadrant(cleanParentsOnly, false)], "upper");

    // 2. Render Left Quad
    const cleanFriendsOnly = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend");
    this.containerEl.toggleClass("rv-no-left", cleanFriendsOnly.length === 0);
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
    
    this.drawAllGraphLines(); 
  }

  private renderQuadrant(area: HTMLElement, collections: Node[][], areaName: string) {
    area.empty(); 
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    const areaFragment = createFragment();
    const collectionWrapper = areaFragment.createDiv(RV.COLLECTION_WRAPPER);

    collections.forEach((collection, collectionIdx) => {
      if (collection.length === 0) return;
      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV.COL_WRAPPER });
          
      const tagGroupedNotes = this.graph.groupByFirstTag(collection);
      this.renderGroupCollection(colWrapDiv, tagGroupedNotes, noteCount);

      if (collectionIdx > 0) {
        const firstItemInCollection = colWrapDiv.querySelector<HTMLElement>('.item');
        if (firstItemInCollection) firstItemInCollection.addClass('rv-collection-start');
      }

      if (areaName === "upper" || areaName === "left") {
        const colCount = collection.length > 6 ? 2 : 1;
        this.distributeItemsIntoFlexColumns(colWrapDiv, colCount);
      }
    });
    
    area.appendChild(areaFragment);

    if (areaName === "lower") this.reflowHorizontalArea(this.lower, true);
    if (areaName === "right") this.reflowHorizontalArea(this.right, false);
  }

  private distributeItemsIntoFlexColumns(colWrapDiv: HTMLElement, colCount: number): void {
    const items = Array.from(colWrapDiv.querySelectorAll<HTMLElement>('.item'));
    if (items.length === 0 || colCount < 1) return;

    const cols: HTMLElement[] = [];
    for (let i = 0; i < colCount; i++) {
      cols.push(colWrapDiv.createDiv({ cls: 'rv-flex-col' }));
    }

    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];
    if (!firstCol || !lastCol) return;

    const visibleItems = items.filter((el: HTMLElement) => !el.classList.contains('hidden'));
    const hiddenItems = items.filter((el: HTMLElement) => el.classList.contains('hidden'));
    const perCol = Math.max(1, Math.ceil(visibleItems.length / colCount));

    visibleItems.forEach((item: HTMLElement, idx: number) => {
      const colIndex = Math.min(Math.floor(idx / perCol), colCount - 1);
      const targetCol = cols[colIndex] ?? firstCol;
      targetCol.appendChild(item);
    });

    hiddenItems.forEach((item: HTMLElement) => {
      const prevParent = item.previousElementSibling?.parentElement;
      if (prevParent && prevParent.classList.contains('rv-flex-col')) {
        prevParent.appendChild(item);
      } else {
        lastCol.appendChild(item);
      }
    });
  }

  public reflowHorizontalArea(areaEl: HTMLElement | undefined, isLower: boolean): void {
    const collectionWrapper = areaEl?.querySelector<HTMLElement>(`.${RV.COLLECTION_WRAPPER}`);
    if (!collectionWrapper) return;

    const allItems = Array.from(collectionWrapper.querySelectorAll<HTMLElement>('.item'));
    if (allItems.length === 0) return;

    const visibleCount = allItems.filter(el => !el.classList.contains('hidden')).length;
    const colCount = isLower
      ? this.getLowerColumnCount(visibleCount)
      : Math.max(1, Math.ceil(visibleCount / 5));

    if (isLower) {
      collectionWrapper.toggleClass('is-scrolling', visibleCount > 24);
    }

    const newCols: HTMLElement[] = [];
    for (let i = 0; i < colCount; i++) {
      const col = createDiv({ cls: 'rv-flex-col' });
      newCols.push(col);
    }

    const firstCol = newCols[0]!;
    const perCol = Math.max(1, Math.ceil(visibleCount / colCount));
    let visibleIdx = 0;
    let currentCol: HTMLElement = firstCol;

    for (const item of allItems) {
      if (!item.classList.contains('hidden')) {
        const colIndex = Math.min(Math.floor(visibleIdx / perCol), colCount - 1);
        currentCol = newCols[colIndex] ?? firstCol;
        visibleIdx++;
      }
      currentCol.appendChild(item);
    }

    collectionWrapper.querySelectorAll('.rv-flex-col').forEach(col => col.remove());
    newCols.forEach(col => collectionWrapper.appendChild(col));
  }

  private getLowerColumnCount(count: number): number {
    if (count <= 1) return 1;
    if (count <= 6) return 2;
    if (count <= 12) return 3;
    if (count <= 24) return 4;
    return Math.ceil(count / 6);
  }

  private renderGroupCollection(targetContainer: HTMLElement, groupedData: { tag: string; notes: Node[] }[], totalNoteCount: number) {
    groupedData.forEach(group => {
      const groupDiv = targetContainer.createDiv({ cls: RV.GROUPS });
      const overGrensen = group.notes.length > 4 && totalNoteCount > 20;

      group.notes.forEach((node, index) => {
        const noteEl = NodeRenderer.renderNodeElement(node, targetContainer, this.center === targetContainer, this.plugin.sclBridge);
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

  public clearTransientHoverState() { 
    this.hoverManager.clearHoverHighlight(); 
  }
  // #endregion
}
