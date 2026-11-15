import { MyBrainView } from './view.js';
import { Platform, HoverParent } from 'obsidian';
import { RV } from '../constants.js';

export class ViewLinkHandler {
  private view: MyBrainView;
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;

  constructor(view: MyBrainView) {
    this.view = view;
  }

  /**
   * Hooks pointer events directly into core container document streams.
   */
  public registerEvents(contentEl: HTMLElement, hoverParent: HoverParent): void {
    contentEl.on('click', ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      event.preventDefault();
      const path: string | null = target.getAttribute("data-link-path");
      if (path !== null) void this.view.handleLinkClick(path);
    });

    contentEl.on('mouseover', ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      this.lastMouseEvent = event;
      this.lastMouseTarget = target;

      if (Platform.isMobile) {
        const oldOrigin: NodeListOf<HTMLElement> = contentEl.querySelectorAll('.item.is-pressed-origin');
        oldOrigin.forEach((el: HTMLElement) => el.classList.remove('is-pressed-origin'));
      }

      const parentItem: HTMLElement | null = target.closest('.item') as HTMLElement | null;
      if (parentItem !== null && Platform.isMobile) {
        parentItem.classList.add('is-pressed-origin');
      }

      if (event.metaKey && !target.classList.contains('is-hovered')) {
        this.triggerCorePreview(event, target, hoverParent);
        target.classList.add('is-hovered');
      }
    });

    contentEl.on('mouseleave', ".focusable-note-link", (_event: MouseEvent, target: HTMLElement) => {
      target.classList.remove('is-hovered');
      this.lastMouseEvent = null;
      this.lastMouseTarget = null;
    });

    this.view.registerDomEvent(window, 'keydown', (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        if (this.lastMouseTarget && this.lastMouseTarget.matches(':hover')) {
          if (this.lastMouseEvent && !this.lastMouseTarget.classList.contains('is-hovered')) {
            this.triggerCorePreview(this.buildSyntheticEvent(), this.lastMouseTarget, hoverParent);
            this.lastMouseTarget.classList.add('is-hovered');
          }
        }
      }
    });

    this.view.registerDomEvent(window, 'keyup', (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        const elements: NodeListOf<HTMLElement> = contentEl.querySelectorAll(".focusable-note-link.is-hovered");
        elements.forEach((el: HTMLElement) => el.classList.remove("is-hovered"));
      }
    });
  }

  public flushMousePointers(): void {
    this.lastMouseEvent = null;
    this.lastMouseTarget = null;
  }

  private triggerCorePreview(event: MouseEvent, targetBox: HTMLElement, hoverParent: HoverParent): void {
    const linktext: string | null = targetBox.getAttribute("data-link-path") || targetBox.getAttribute("data-href");
    const sourcePath: string | null = targetBox.getAttribute("data-link-path");

    if (linktext !== null) {
      this.view.app.workspace.trigger('hover-link', {
        event,
        source: RV.VIEW_TYPE,
        targetEl: targetBox,
        linktext,
        sourcePath: sourcePath || linktext,
        hoverParent
      });
    }
  }

  private buildSyntheticEvent(): MouseEvent {
    return new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      view: window,
      metaKey: true,
      ctrlKey: true,
      clientX: this.lastMouseEvent ? this.lastMouseEvent.clientX : 0,
      clientY: this.lastMouseEvent ? this.lastMouseEvent.clientY : 0
    });
  }
}
