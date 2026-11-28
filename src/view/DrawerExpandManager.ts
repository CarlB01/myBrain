import { Platform } from "obsidian";
import { RV } from "../utils/constants.js";

export class DrawerExpandManager {
  private containerEl: HTMLElement;
  private onRequestRedraw: () => void;

  private dwellTimer: number | null = null;
  private collapseTimer: number | null = null;
  private isExpanded = false;

  private activeLowerEl: HTMLElement | null = null;
  private placeholderEl: HTMLElement | null = null;
  private originalParent: HTMLElement | null = null;
  private originalNextSibling: Node | null = null;
  private portalEl: HTMLElement | null = null;
  private portalSvgEl: SVGSVGElement | null = null;
  private portalSvgHostEl: HTMLElement | null = null;
  private portalBackdropEl: HTMLElement | null = null;

  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseLeave: ((e: MouseEvent) => void) | null = null;
  private onLinkClick: (path: string) => void;
  private onItemHover: (notePath: string | null) => void;
  private onPlusMinusClick: (btn: HTMLElement) => void;
  private boundPortalScroll = (): void => { this.onRequestRedraw() };

  private readonly dwellDelayMs = 2000;
  private readonly collapseDelayMs = 220;

  public getPortalSvg(): SVGSVGElement | null {
    return this.portalSvgEl;
  }

  constructor(
    containerEl: HTMLElement,
    onRequestRedraw: () => void,
    onLinkClick: (path: string) => void,
    onPlusMinusClick: (btn: HTMLElement) => void,
    onItemHover: (notePath: string | null) => void
  ) {
    this.containerEl = containerEl;
    this.onRequestRedraw = onRequestRedraw;
    this.onLinkClick = onLinkClick;
    this.onPlusMinusClick = onPlusMinusClick;
    this.onItemHover = onItemHover;
  }
  
  public setup(): void {
    this.teardown();
    if (Platform.isMobile) return;

    this.boundMouseMove = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      const lowerArea = this.activeLowerEl ?? this.containerEl.querySelector<HTMLElement>(".rv-area.lower");
      if (!lowerArea) return;

      const isInsideLower = lowerArea.contains(target) || Boolean(this.portalEl?.contains(target));

      if (isInsideLower) {
        this.cancelCollapseTimer();
        if (!this.isExpanded && this.dwellTimer === null && this.canExpand(lowerArea)) {
          this.dwellTimer = window.setTimeout(() => {
            this.dwellTimer = null;
            this.expand(lowerArea);
          }, this.dwellDelayMs);
        }
      } else {
        this.cancelDwellTimer();
        if (this.isExpanded && this.collapseTimer === null) {
          this.collapseTimer = window.setTimeout(() => {
            this.collapseTimer = null;
            this.collapse();
          }, this.collapseDelayMs);
        }
      }
    };

    this.boundMouseLeave = (event: MouseEvent) => {
      const related = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
      if (related && this.activeLowerEl?.contains(related)) return;

      this.cancelDwellTimer();
      if (this.isExpanded && this.collapseTimer === null) {
        this.collapseTimer = window.setTimeout(() => {
          this.collapseTimer = null;
          this.collapse();
        }, this.collapseDelayMs);
      }
    };

    document.addEventListener("mousemove", this.boundMouseMove, { passive: true });
    this.containerEl.addEventListener("mouseleave", this.boundMouseLeave, { passive: true });
  }

  public teardown(): void {
    this.cancelDwellTimer();
    this.cancelCollapseTimer();
    this.collapse();

    if (this.boundMouseMove) {
      document.removeEventListener("mousemove", this.boundMouseMove);
      this.boundMouseMove = null;
    }
    if (this.boundMouseLeave) {
      this.containerEl.removeEventListener("mouseleave", this.boundMouseLeave);
      this.boundMouseLeave = null;
    }
  }

  private canExpand(lowerArea: HTMLElement): boolean {
    const leftDrawer = this.containerEl.closest<HTMLElement>(".mod-left-split, .workspace-drawer.mod-left");
    if (!leftDrawer) return false;

    return lowerArea.scrollWidth > lowerArea.clientWidth + 2;
  }

  private expand(lowerArea: HTMLElement): void {
    if (this.isExpanded || !this.canExpand(lowerArea)) return;

    const parent = lowerArea.parentElement;
    if (!parent) return;

    // 1. Mål eksakt posisjon, scroll og kolonnebredde før flytting
    const rect = lowerArea.getBoundingClientRect();
    const savedScrollLeft = lowerArea.scrollLeft;
    const firstCol = lowerArea.querySelector<HTMLElement>(`.${RV.COLUMNS}`);
    const colWidth = firstCol?.getBoundingClientRect().width ?? 0;

    if (colWidth > 0) {
      lowerArea.style.setProperty("--rv-locked-col-width", `${colWidth}px`);
    }

    // 2. Plassholder i skuffen så gridet ikke hopper
    const placeholder = createDiv({ cls: "rv-area lower rv-lower-placeholder" });
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.visibility = "hidden";

    this.originalParent = parent;
    this.originalNextSibling = lowerArea.nextSibling;
    this.placeholderEl = placeholder;
    this.activeLowerEl = lowerArea;

    parent.insertBefore(placeholder, lowerArea);

    // 3. Beregn maks tilgjengelig høyde (samme budsjett som skuffen har)
    const containerH = this.containerEl.clientHeight;
    const isNoUpper = this.containerEl.classList.contains("rv-no-upper");
    const maxAvailableH = Math.max(80, Math.floor(containerH * (isNoUpper ? 0.78 : 0.44)));

        // 4a. Eget bakgrunnslag bakerst (z-index 98) slik at streker og noder har samme lagrekkefølge som i hovedgrafen
    const backdrop = document.body.createDiv({ cls: `${RV.CONTAINER} rv-drawer-portal-backdrop` });
    backdrop.style.position = "fixed";
    backdrop.style.top = `${rect.top}px`;
    backdrop.style.left = `${rect.left}px`;
    backdrop.style.height = "auto";
    backdrop.style.maxHeight = `${maxAvailableH}px`;
    backdrop.style.pointerEvents = "none";
    backdrop.style.zIndex = "98";
    this.portalBackdropEl = backdrop;

    // 4b. SVG-lerret i midten (z-index 99) -> foran bakgrunnen, men BAK nodene!
    const svgHost = document.body.createDiv({ cls: `view-content ${RV.CONTAINER} rv-portal-svg-host` });
    svgHost.style.position = "fixed";
    svgHost.style.inset = "0";
    svgHost.style.width = "100vw";
    svgHost.style.height = "100vh";
    svgHost.style.pointerEvents = "none";
    svgHost.style.zIndex = "99";
    svgHost.style.background = "transparent";
    svgHost.style.overflow = "visible";

    const portalSvg = svgHost.createSvg("svg", { cls: RV.SVG_LAYER });
    portalSvg.style.width = "100%";
    portalSvg.style.height = "100%";
    this.portalSvgHostEl = svgHost;
    this.portalSvgEl = portalSvg;

    // 4c. Gjennomsiktig node-portal øverst (z-index 100)
    const portal = document.body.createDiv({ cls: `${RV.CONTAINER} rv-drawer-portal` });
    portal.style.position = "fixed";
    portal.style.top = `${rect.top}px`;
    portal.style.left = `${rect.left}px`;
    portal.style.height = "auto";
    portal.style.maxHeight = `${maxAvailableH}px`;
    portal.style.zIndex = "100";


    portal.addEventListener("mouseover", (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(`.${RV.ITEM}`) : null;
      const notePath = target?.getAttribute("data-note-path") ?? null;
      this.onItemHover(notePath);
    }, true);

    portal.addEventListener("mouseout", (event: MouseEvent) => {
      const related = event.relatedTarget instanceof HTMLElement ? event.relatedTarget.closest<HTMLElement>(`.${RV.ITEM}`) : null;
      if (!related) {
        this.onItemHover(null);
      }
    }, true);

    portal.addEventListener("click", (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      const plusMinusBtn = target.closest<HTMLElement>(`.${RV.PLUS_MINUS_BTN}`);
      if (plusMinusBtn) {
        event.preventDefault();
        event.stopPropagation();
        this.onPlusMinusClick(plusMinusBtn);
        return;
      }

      const linkEl = target.closest<HTMLElement>(`.${RV.A}`);
      if (linkEl) {
        event.preventDefault();
        event.stopPropagation();
        const path = linkEl.getAttribute("data-href");
        this.collapse();
        if (path) this.onLinkClick(path);
      }
    }, true);

    lowerArea.style.position = "relative";
    lowerArea.style.zIndex = "2";
    lowerArea.style.height = "auto";
    lowerArea.style.maxHeight = `${maxAvailableH}px`;
    lowerArea.style.minWidth = `${rect.width}px`;
    lowerArea.addClass(RV.DRAWER_EXPANDED);

    portal.appendChild(lowerArea);
    lowerArea.addEventListener("scroll", this.boundPortalScroll, { passive: true });
    lowerArea.scrollLeft = savedScrollLeft;
    this.portalEl = portal;

    // Synkroniser størrelsen på backdrop med portalen
    const pRect = portal.getBoundingClientRect();
    backdrop.style.width = `${pRect.width}px`;
    backdrop.style.height = `${pRect.height}px`;

    this.isExpanded = true;
    this.onRequestRedraw();
  }

  public syncAfterReflow(): void {
    if (!this.isExpanded || !this.activeLowerEl || !this.placeholderEl) return;
    const newHeight = this.activeLowerEl.getBoundingClientRect().height;
    if (newHeight > 0) {
      this.placeholderEl.style.height = `${newHeight}px`;
    }
    if (this.portalEl && this.portalBackdropEl) {
      const pRect = this.portalEl.getBoundingClientRect();
      this.portalBackdropEl.style.width = `${pRect.width}px`;
      this.portalBackdropEl.style.height = `${pRect.height}px`;
    }
  }

  public collapse(): void {
    if (!this.isExpanded || !this.activeLowerEl) return;

    const lowerArea = this.activeLowerEl;
    lowerArea.removeEventListener("scroll", this.boundPortalScroll);
    const savedScrollLeft = lowerArea.scrollLeft;

    lowerArea.removeClass(RV.DRAWER_EXPANDED);
    lowerArea.style.removeProperty("position");
    lowerArea.style.removeProperty("z-index");
    lowerArea.style.removeProperty("height");
    lowerArea.style.removeProperty("max-height");
    lowerArea.style.removeProperty("min-width");
    lowerArea.style.removeProperty("--rv-locked-col-width");

    if (this.originalParent) {
      this.originalParent.insertBefore(lowerArea, this.originalNextSibling);
      lowerArea.scrollLeft = savedScrollLeft;
    }

    this.portalEl?.remove();
    this.portalEl = null;
    this.portalBackdropEl?.remove();
    this.portalBackdropEl = null;
    this.portalSvgHostEl?.remove();
    this.portalSvgHostEl = null;
    this.portalSvgEl?.remove();
    this.portalSvgEl = null;
    this.placeholderEl?.remove();
    this.placeholderEl = null;
    this.activeLowerEl = null;
    this.originalParent = null;
    this.originalNextSibling = null;
    this.isExpanded = false;
    this.onItemHover(null);

    this.onRequestRedraw();
  }

  private cancelDwellTimer(): void {
    if (this.dwellTimer !== null) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  private cancelCollapseTimer(): void {
    if (this.collapseTimer !== null) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
  }
}
