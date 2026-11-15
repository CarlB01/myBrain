import { MyBrainView } from './view.js';
import { debounce, Debouncer } from 'obsidian';

export class ViewLifecycleManager {
  private view: MyBrainView;
  private visibilityObserver: IntersectionObserver | null = null;

  public debouncedLayout: Debouncer<[], void>;
  public debouncedOrientation: Debouncer<[], void>;
  public debouncedActiveLeaf: Debouncer<[], void>;
  public debouncedVisibilityResume: Debouncer<[], void>;
  public debouncedResolve: Debouncer<[], void>;

  constructor(view: MyBrainView) {
    this.view = view;

    this.debouncedLayout = debounce(this.view.executeLayoutRefresh.bind(this.view), 60, true);
    this.debouncedOrientation = debounce(this.view.executeOrientationChange.bind(this.view), 100, true);
    this.debouncedActiveLeaf = debounce(this.view.executeActiveLeafChange.bind(this.view), 50, true);
    this.debouncedVisibilityResume = debounce(this.view.executeVisibilityResume.bind(this.view), 120, true);
    this.debouncedResolve = debounce(this.view.executeResolve.bind(this.view), 120, true);
  }

  /**
   * Spreads ResizeObservers and event telemetry hooks across active document layouts.
   */
  public registerZoomObservers(): void {
    // Vi bruker den standardiserte nettlesertypen 'Window' i stedet for å tvinge inn globalThis
    const currentWindow: Window = this.view.containerEl.win || window;
    const currentDocument: Document = this.view.containerEl.doc || document;

    const safeRedraw = (): void => {
      if (this.view.isSuspended || !this.view.isFullyStarted) return;
      currentWindow.requestAnimationFrame(() => {
        if (this.view.areaManager) this.view.areaManager.requestRedraw();
      });
      this.debouncedLayout();
    };

    const zoomObserver = new ResizeObserver(() => { safeRedraw(); });
    if (currentDocument.documentElement) zoomObserver.observe(currentDocument.documentElement);
    this.view.register(() => zoomObserver.disconnect());

    const onWheelCapture = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      safeRedraw();
    };

    currentWindow.addEventListener("wheel", onWheelCapture, { passive: true, capture: true });
    this.view.register(() => currentWindow.removeEventListener("wheel", onWheelCapture, { capture: true }));
  }

  /**
   * Mounts a low-overhead IntersectionObserver viewport monitoring fence.
   */
  public setupVisibilityObserver(containerEl: HTMLElement): void {
    this.visibilityObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.view.handleViewportIntersection();
        } else {
          this.view.setPanelHiddenState(true);
        }
      }
    }, { threshold: 0.1 });

    this.visibilityObserver.observe(containerEl);
    this.view.register(() => this.visibilityObserver?.disconnect());
  }

  public cancelAll(): void {
    this.debouncedLayout.cancel();
    this.debouncedOrientation.cancel();
    this.debouncedActiveLeaf.cancel();
    this.debouncedVisibilityResume.cancel();
    this.debouncedResolve.cancel();
  }

  public disconnectObserver(): void {
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
  }
}
