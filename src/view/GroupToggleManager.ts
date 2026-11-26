import { Node } from "../data/Node.js";
import { RV } from "../utils/constants.js";

export class GroupToggleManager {
  private containerEl: HTMLElement;
  private boundClickHandler: ((event: MouseEvent) => void) | null = null;
  private onRequestRedraw: () => void;
  private groupNotesByBtn = new WeakMap<HTMLElement, Node[]>();

  constructor(containerEl: HTMLElement, onRequestRedraw: () => void) {
    this.containerEl = containerEl;
    this.onRequestRedraw = onRequestRedraw;
  }

  public setup(): void {
    this.teardown();

    this.boundClickHandler = (event: MouseEvent) => {
      const rawTarget = event.target instanceof HTMLElement ? event.target : null;
      if (!rawTarget) return;

      const btn = rawTarget.closest<HTMLElement>(`.${RV.PLUS_MINUS_BTN}`);
      if (!btn || !this.containerEl.contains(btn)) return;

      event.preventDefault();
      this.onPlusMinusBtnClicked(btn);
    };

    this.containerEl.addEventListener("click", this.boundClickHandler, true);
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

    // Lagre direkte kobling til gruppens noder
    this.groupNotesByBtn.set(button, group.notes);

    return button;
  }

  private onPlusMinusBtnClicked(target: HTMLElement): void {
    const notes = this.groupNotesByBtn.get(target);
    if (!notes) return;

    const items = notes
      .map((n) => n.div)
      .filter((div): div is HTMLElement => div !== null);

    if (items.length <= 1) return;

    const isExpanding = (target.textContent ?? "").includes(RV.PLUS);
    const count = items.length.toString();
    const cleanTagName = (target.getAttribute("data-tag") ?? "").replace(/^#/, "");

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      item.toggleClass("is-group-expanded", isExpanding);
      if (i > 0) {
        item.toggleClass("hidden", !isExpanding);
      }
    }

    target.textContent = isExpanding
      ? `${RV.MINUS}${cleanTagName}(${count})`
      : `${RV.PLUS}${cleanTagName}(${count})`;

    this.onRequestRedraw();
  }
}
