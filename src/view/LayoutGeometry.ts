import { Platform, Point } from "obsidian";
import { RV } from "../constants.js";

export class LayoutGeometry {
  /**
   * Compute dynamic max-height budgets per scroll-wrapper from the container's
   * real pixel height and push them as CSS variables.
   */
  public static allocateAreaHeights(
    containerEl: HTMLElement, 
    center: HTMLElement, 
    upper: HTMLElement, 
    left: HTMLElement, 
    lower: HTMLElement
  ): void {
    if (!containerEl?.isConnected || !center) return;

    const CW = `.${RV.COLLECTION_WRAPPER}`;
    const upperScroller = upper?.querySelector(CW) as HTMLElement;
    const leftScroller  = left?.querySelector(CW) as HTMLElement;
    const lowerScroller = lower?.querySelector(CW) as HTMLElement;
    
    const upperScrollHeight = upperScroller?.scrollHeight ?? 0;
    const leftScrollHeight = leftScroller?.scrollHeight ?? 0;
    const lowerScrollHeight = lowerScroller?.scrollHeight ?? 0;
    const midScrollHeight = center.scrollHeight;

    const leftPeakAboveCenter = Math.max(0, leftScrollHeight - center.scrollHeight);
    const maxUpperOrLeftScroll = Math.max(1, upperScrollHeight, leftPeakAboveCenter);
    const totalScrollHeight = Math.max(1, maxUpperOrLeftScroll + midScrollHeight + lowerScrollHeight);
    const upperFraction = maxUpperOrLeftScroll / totalScrollHeight;

    const upperProposal = upperFraction * containerEl.clientHeight;
    let upperH = Math.max(upperProposal, 0.2 * containerEl.clientHeight); 
    upperH = Math.floor(Math.min(upperH, 0.5 * containerEl.clientHeight));
    
    const leftH = upperH + midScrollHeight;
    const rightH = containerEl.clientHeight;
    
    let safeLower = Math.max(0, containerEl.clientHeight - (upperH + midScrollHeight));
    if (lowerScrollHeight > 0 && lowerScrollHeight < safeLower) {
      safeLower = lowerScrollHeight;
    }
    
    containerEl.style.setProperty("--rv-upper-max", `${upperH}px`);
    containerEl.style.setProperty("--rv-left-max", `${leftH}px`);
    containerEl.style.setProperty("--rv-right-max", `${rightH}px`);
    containerEl.style.setProperty("--rv-lower-max", `${safeLower}px`);
  }

  public static yieldIfLeftTall(containerEl: HTMLElement, center: HTMLElement): void {
    const leftWrapper = containerEl.querySelector('.rv-area.left') as HTMLElement;
    if (!leftWrapper) return;
    const currentValue = containerEl.getAttribute(RV.LEFT_TALL);
    const isLeftTall = leftWrapper.scrollHeight > center.offsetHeight + 15;
    const newValue = isLeftTall ? "true" : "false";

    if (currentValue !== newValue) containerEl.setAttribute(RV.LEFT_TALL, newValue);
  }

  public static yieldIfRightTall(containerEl: HTMLElement, center: HTMLElement, upper: HTMLElement): void {
    const rightWrapper = containerEl.querySelector('.rv-area.right') as HTMLElement;
    if (!rightWrapper) return;
    const currentValue = containerEl.getAttribute(RV.RIGHT_TALL);
    const isRightTall = rightWrapper.scrollHeight > (center.offsetHeight + upper.offsetHeight + 15);
    const newValue = isRightTall ? "true" : "false";

    if (currentValue !== newValue) containerEl.setAttribute(RV.RIGHT_TALL, newValue);
  }

  public static offBy(containerEl: HTMLElement): Point | null {
    if (!containerEl) return null;
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    let x = rect.left;
    let y = rect.top;

    if (Platform.isMobile) {
      x += window.scrollX || 0;
      y += window.scrollY || 0;
    } else {
      x += containerEl.scrollLeft || 0;
      y += containerEl.scrollTop || 0;
    }
    return { x, y };
  }

  public static isBadGateRect(rect: DOMRect, cornerEpsilon: number): boolean {
    if (!rect) return true;
    if (rect.width <= 0 || rect.height <= 0) return true;
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return true;
    if (rect.left <= cornerEpsilon && rect.top <= cornerEpsilon) return true;
    return false;
  }
}
