import { MyBrainView } from './view.js';
import { Platform, HoverParent } from 'obsidian';
import { RV } from '../utils/constants.js';

export class ViewLinkHandler {
  private view: MyBrainView;
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;

  constructor(view: MyBrainView) {
    this.view = view;
  }

  public registerEvents(contentEl: HTMLElement, hoverParent: HoverParent): void {
    contentEl.on('click', `.${RV.A}`, (event: MouseEvent, target: HTMLElement) => {
      event.preventDefault();
      const path: string | null = target.getAttribute("data-href");
      if (path !== null) void this.view.handleLinkClick(path);
    });

    contentEl.on('mouseover', `.${RV.A}`, (event: MouseEvent, target: HTMLElement) => {
      this.lastMouseEvent = event;
      this.lastMouseTarget = target;

      // Oppdater linjene umiddelbart når hover/tema/SCL endrer størrelse på noden
      this.view.areaManager?.requestRedraw();

      if (Platform.isMobile) {
        const oldOrigin: NodeListOf<HTMLElement> = contentEl.querySelectorAll('.item.is-pressed-origin');
        oldOrigin.forEach((el: HTMLElement) => el.classList.remove('is-pressed-origin'));
      }

      const parentItem = target.closest('.item');
      if (parentItem !== null && Platform.isMobile) {
        parentItem.classList.add('is-pressed-origin');
      }

      if ((event.metaKey || event.ctrlKey) && !target.classList.contains('is-hovered')) {
        this.triggerCorePreview(event, target, hoverParent);
        target.classList.add('is-hovered');
      }
    });

    contentEl.on('mouseleave', `.${RV.A}`, (_event: MouseEvent, target: HTMLElement) => {
      target.classList.remove('is-hovered');
      this.lastMouseEvent = null;
      this.lastMouseTarget = null;

      // Trekk linjene tilbake når noden krymper til normal størrelse
      this.view.areaManager?.requestRedraw();
    });

    // Fanger opp slutten på CSS-animasjonen (scale 1.05 / tema-overgang) for 100 % presisjon
    this.view.registerDomEvent(contentEl, 'transitionend', (event: TransitionEvent) => {
      if (event.propertyName === 'transform' || event.propertyName === 'border-width' || event.propertyName === 'padding') {
        this.view.areaManager?.requestRedraw();
      }
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
        // Rettet: La til punktum foran ${RV.A} slik at CSS-selektoren matcher klassen
        const elements: NodeListOf<HTMLElement> = contentEl.querySelectorAll(`.${RV.A}.is-hovered`);
        elements.forEach((el: HTMLElement) => el.classList.remove("is-hovered"));
      }
    });
  }

  public flushMousePointers(): void {
    this.lastMouseEvent = null;
    this.lastMouseTarget = null;
  }

  private triggerCorePreview(event: MouseEvent, targetBox: HTMLElement, hoverParent: HoverParent): void {
    const linktext: string | null = targetBox.getAttribute("data-href");
    if (linktext === null) return;

    this.view.app.workspace.trigger('hover-link', {
      event,
      source: RV.VIEW_TYPE,
      targetEl: targetBox,
      linktext,
      sourcePath: this.view.currentFilePath || linktext,
      hoverParent
    });
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
