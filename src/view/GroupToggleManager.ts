import { Node } from "../data/Node.js";
import { RV } from "../utils/constants.js";

export class GroupToggleManager {
  private containerEl: HTMLElement;
  private boundClickHandler: ((event: MouseEvent) => void) | null = null;
  private onRequestRedraw: () => void;

  constructor(containerEl: HTMLElement, onRequestRedraw: () => void) {
    this.containerEl = containerEl;
    this.onRequestRedraw = onRequestRedraw;
  }

  public setup(delegatedHandlersBound: boolean): { handler: (e: MouseEvent) => void; bound: boolean } {
    this.teardown();

    this.boundClickHandler = (event: MouseEvent) => {
      const rawTarget = event.target as HTMLElement | null;
      if (!rawTarget) return;

      const btn = rawTarget.closest(`.${RV.PLUS_MINUS_BTN}`) as HTMLElement;
      if (!btn) return;
      if (!this.containerEl.contains(btn)) return;

      event.preventDefault();
      this.onPlusMinusBtnClicked(btn);
    };

    this.containerEl.addEventListener("click", this.boundClickHandler, true);
    return { handler: this.boundClickHandler, bound: true };
  }

  public teardown(): void {
    if (this.boundClickHandler) {
      this.containerEl.removeEventListener("click", this.boundClickHandler, true);
      this.boundClickHandler = null;
    }
  }

  public buildPlusMinusBtn(firstNoteDiv: HTMLElement, group: { tag: string; notes: Node[] }, startsClosed: boolean): HTMLElement {
    const count = group.notes.length.toString();
    const cleanTagName = group.tag.replace(/^#/, "");
    const button = firstNoteDiv.createDiv(`${RV.PLUS_MINUS_BTN} ${RV.BORDERED} ${RV.ROUNDED}`);
    
    button.textContent = startsClosed ? `${RV.PLUS}${cleanTagName}(${count})` : `${RV.MINUS}${cleanTagName}(${count})`; 
    button.setAttribute("data-count", count);
    button.setAttribute("data-tag", group.tag);
    button.setAttribute('data-link-tags', group.tag);

    return button;
  }

  private onPlusMinusBtnClicked(target: HTMLElement): void {
    const groupDiv = target.closest(`.${RV.GROUPS}`) as HTMLElement;
    if (!groupDiv) return;

    const items = Array.from(groupDiv.querySelectorAll('.item'));
    if (items.length <= 1) return;

    const textContent = target.textContent || "";
    const count = items.length.toString();
    const rawTag = target.getAttribute("data-tag") || "";
    const cleanTagName = rawTag.replace(/^#/, "");
      
    if (textContent.includes(RV.PLUS)) {
      groupDiv.addClass('expanded');
      items.slice(1).forEach(item => item.removeClass('hidden'));
      target.textContent = `${RV.MINUS}${cleanTagName}(${count})`;
    } else {
      groupDiv.removeClass('expanded');
      items.slice(1).forEach(item => item.addClass('hidden'));      
      target.textContent = `${RV.PLUS}${cleanTagName}(${count})`;
    }

    this.onRequestRedraw();
  }
}
