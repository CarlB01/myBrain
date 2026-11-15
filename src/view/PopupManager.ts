import { NetworkGraph } from "../NetworkGraph.js";
import MyBrainPlugin from "../main.js";
import { RV } from "../constants.js";
import { Platform } from "obsidian";

export class PopupManager {
  public activeInfoPopup: HTMLElement | null = null;
  private containerEl: HTMLElement;
  private plugin: MyBrainPlugin;

  constructor(containerEl: HTMLElement, plugin: MyBrainPlugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  public cleanupPopup(): void {
    if (this.activeInfoPopup) {
      this.activeInfoPopup.remove();
      this.activeInfoPopup = null;
    }
  }

  public repositionPopup(target: HTMLElement): void {
    if (!this.activeInfoPopup) return;

    const popupWidth = this.activeInfoPopup.offsetWidth || 180;
    const viewRect = this.containerEl.getBoundingClientRect();
    const btnRect = target.getBoundingClientRect();
    const padding = 10;

    const collidesOnRightSide = (btnRect.right + padding + popupWidth) > viewRect.right;
    this.activeInfoPopup.style.left = collidesOnRightSide 
      ? `${btnRect.left - viewRect.left - popupWidth - padding}px`
      : `${btnRect.right - viewRect.left + padding}px`;

    this.activeInfoPopup.style.top = `${btnRect.top - viewRect.top - 15}px`;
    this.activeInfoPopup.removeClass('is-measuring');
  }

  public openInteractiveIgnoredList(target: HTMLElement, graph: NetworkGraph): void {
    if (this.activeInfoPopup?.classList.contains('active-list')) {
      this.cleanupPopup();
      return;
    }

    const ignoredGroups = graph.ignoredGroups;
    if (!ignoredGroups || ignoredGroups.size === 0) return;

    this.cleanupPopup();
    this.activeInfoPopup = createDiv({ cls: `${RV.INFO_HOVER} active-list rv-ignored-popup-shell` });

    this.plugin.registerDomEvent(this.activeInfoPopup, "click", (e: MouseEvent) => e.stopPropagation());
    const popupFragment = createFragment();
    const headerWrapper = popupFragment.createDiv({ cls: "rv-ignored-header-wrapper" });
    headerWrapper.createSpan({ cls: "rv-ignored-header-text", text: "Hidden / Cause" });

    ignoredGroups.forEach((nodes, reason) => {
      if (!nodes || nodes.length === 0) return;

      const groupDiv = popupFragment.createDiv({ cls: "rv-ignored-pure-group" });
      const cleanReason = reason.replace(/^#/, ""); 
      const headerBtn = groupDiv.createDiv({ cls: "rv-plusminus rv-ignored-pure-btn", text: `${RV.PLUS}${cleanReason}(${nodes.length})` });

      headerBtn.setAttribute("data-reason", cleanReason);
      headerBtn.setAttribute("data-count", String(nodes.length));

      const linksContainer = groupDiv.createDiv({ cls: "rv-ignored-pure-container" });

      nodes.forEach(node => {
        const itemWrapper = linksContainer.createDiv({ cls: "rv-ignored-pure-item" });
        const linkEl = itemWrapper.createEl("a", { cls: "focusable-note-link supercharged rv-ignored-note-link" });
        linkEl.setAttribute("data-link-path", node.path);
        linkEl.createSpan({ text: node.displayText, cls: "rv-text-span" });

        this.plugin.registerDomEvent(linkEl, "click", (e: MouseEvent) => {
          e.preventDefault(); e.stopPropagation();
          void this.plugin.app.workspace.openLinkText(node.path, "", false);
          this.cleanupPopup();
        });
      });

      this.plugin.registerDomEvent(headerBtn, "click", (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        const clickedBtn = e.currentTarget as HTMLElement;
        const currentGroupDiv = clickedBtn.closest(".rv-ignored-pure-group") as HTMLElement;
        const targetContainer = currentGroupDiv?.querySelector(".rv-ignored-pure-container") as HTMLElement;
        if (!targetContainer || !clickedBtn) return;

        const reasonName = clickedBtn.getAttribute("data-reason") || "";
        const countStr = clickedBtn.getAttribute("data-count") || "0";
        const isCurrentlyClosed = !targetContainer.classList.contains("is-visible");

        if (isCurrentlyClosed) {
          currentGroupDiv.classList.add("expanded");
          targetContainer.classList.add("is-visible");
          clickedBtn.textContent = `${RV.MINUS}${reasonName}(${countStr})`;
        } else {
          currentGroupDiv.classList.remove("expanded");
          targetContainer.classList.remove("is-visible");
          clickedBtn.textContent = `${RV.PLUS}${reasonName}(${countStr})`;
        }
      });
    });

    this.activeInfoPopup.appendChild(popupFragment);
    this.containerEl.appendChild(this.activeInfoPopup);
    this.repositionPopup(target);

    window.setTimeout(() => {
      this.plugin.registerDomEvent(document, "click", (clickEvent: MouseEvent) => {
        if (!this.activeInfoPopup) return;
        if (!(clickEvent.target as HTMLElement).closest(".rv-info-btn")) this.cleanupPopup();
      }, { once: true });
    }, 50);
  }

  /**
   * Renders the center-node info button and registers natively managed Obsidian event listeners.
   */
  public renderInfoBtnForCenterNode(graph: NetworkGraph): void {
    const centerDiv = graph.centerNote?.div;
    const anchorEl = centerDiv?.querySelector(".rv-linkdiv");
    if (!anchorEl) return;

    anchorEl.querySelector(".rv-info-btn")?.remove();
    const ignoredCount = graph.ignoredNotes?.size || 0;
    if (ignoredCount <= 0) return;

    const infoBtn = createDiv({ cls: "rv-plusminus rv-info-btn", text: "i" });
    infoBtn.setAttribute("data-ignored-count", String(ignoredCount));
    anchorEl.appendChild(infoBtn);

    let pressTimerId: number | null = null; 
    let isLongPress = false;

    this.plugin.registerDomEvent(infoBtn, "mouseover", (e: MouseEvent) => {
      if (this.activeInfoPopup?.classList.contains('active-list')) return;
      this.cleanupPopup();

      if (e.altKey || e.ctrlKey || e.metaKey) {
        this.openInteractiveIgnoredList(infoBtn, graph); 
        return;
      }

      this.activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      this.plugin.registerDomEvent(this.activeInfoPopup, "click", (ev: MouseEvent) => ev.stopPropagation());
      this.activeInfoPopup.createSpan({ text: `${ignoredCount} hidden nodes`, cls: "popup-title" });
      this.activeInfoPopup.addClass('is-measuring');
      this.containerEl.appendChild(this.activeInfoPopup);
      this.repositionPopup(infoBtn);
    });

    this.plugin.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (["Meta", "Control", "Alt"].includes(e.key) && infoBtn.matches(":hover")) {
        this.openInteractiveIgnoredList(infoBtn, graph);
      }
    });

    this.plugin.registerDomEvent(infoBtn, "mouseout", () => {
      if (!this.activeInfoPopup?.classList.contains('active-list')) this.cleanupPopup();
    });

    this.plugin.registerDomEvent(infoBtn, "pointerdown", () => {
      isLongPress = false;
      pressTimerId = window.setTimeout(() => {
        isLongPress = true; 
        this.openInteractiveIgnoredList(infoBtn, graph);
        if (navigator.vibrate) navigator.vibrate(15);
      }, 500);
    });

    this.plugin.registerDomEvent(infoBtn, "pointerup", (e: PointerEvent) => {
      if (pressTimerId !== null) { window.clearTimeout(pressTimerId); pressTimerId = null; }
      if (!isLongPress && !Platform.isMobile) { 
        e.stopPropagation(); 
        this.openInteractiveIgnoredList(infoBtn, graph); 
      }
    });

    this.plugin.registerDomEvent(infoBtn, "pointercancel", () => {
      if (pressTimerId !== null) { window.clearTimeout(pressTimerId); pressTimerId = null; }
    });
  }
}
