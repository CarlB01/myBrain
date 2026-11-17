import { Node } from "../data/Node.js";
import { RV } from "../utils/constants.js";

export class NodeRenderer {
  public static renderNodeElement(node: Node, targetContainer: HTMLElement, isCenter: boolean): HTMLElement {
    node.assignedArea = isCenter ? "center" : node.assignedArea;
    
    let itemDiv: HTMLElement | null = node.div;
      
    if (itemDiv) {
      itemDiv.innerHTML = "";
      itemDiv.className = "item"; 
    } else {
      itemDiv = createDiv({ cls: "item" }); 
      node.div = itemDiv;
    }

    itemDiv.setAttribute("data-note-path", node.path);

    const linkWrapper: HTMLElement = itemDiv.createDiv({ cls: RV.LINKDIV });
    node.linkDivRef = linkWrapper;

    const routingPath: string = node.path.endsWith(".md") ? node.path.slice(0, -3) : node.path;

    // Minimalistisk Obsidian-lenke: kun internal-link + din egen fokus-klasse
    const linkEl: HTMLAnchorElement = createEl("a", { 
      cls: `internal-link ${RV.A}`,
      attr: {
        "data-href": node.path,
        "href": routingPath
      }
    });

    linkEl.textContent = node.displayText;

    // V8 FLYWEIGHT INJECTION: Stemple elementet ferdig i minnet før DOM-montering
    if (node.sclHasMatch) {
      linkEl.classList.add("scl-processed");
      const classes = node.sclClasses;
      for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (cls !== undefined && cls.length > 0) linkEl.classList.add(cls);
      }
      linkEl.setAttribute("data-scl-signature", node.sclSignature);

      if (node.sclColor.length > 0) {
        linkEl.style.setProperty("--scl-color", node.sclColor);
      }
      if (node.sclBgColor.length > 0 && node.sclBgColor !== "transparent") {
        linkEl.style.setProperty("--scl-bg", node.sclBgColor);
      }
      if (node.sclIconBefore.length > 0) {
        linkEl.style.setProperty("--scl-icon-before", `"${node.sclIconBefore}"`);
      }
      if (node.sclIconAfter.length > 0) {
        linkEl.style.setProperty("--scl-icon-after", `"${node.sclIconAfter}"`);
      }
    }

    node.friendGate.direction = node.assignedArea === "left" ? "right" : "left";
    
    node.upperGate.areaElement = targetContainer;
    node.lowerGate.areaElement = targetContainer;
    node.friendGate.areaElement = targetContainer;

    const topSVG: SVGSVGElement = node.upperGate.render();
    const bottomSVG: SVGSVGElement = node.lowerGate.render();
    const friendSVG: SVGSVGElement = node.friendGate.render();
    
    node.upperGate.svg  = topSVG;
    node.lowerGate.svg  = bottomSVG;
    node.friendGate.svg = friendSVG;
    
    linkWrapper.appendChild(topSVG);
    linkWrapper.appendChild(bottomSVG);
    
    if (node.friendGate.direction === "left") {
      linkWrapper.appendChild(friendSVG); 
      linkWrapper.appendChild(linkEl);  
    } else {
      linkWrapper.appendChild(linkEl);  
      linkWrapper.appendChild(friendSVG); 
    }

    return itemDiv;
  }
}