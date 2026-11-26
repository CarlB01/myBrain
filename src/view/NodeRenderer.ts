import { Node } from "../data/Node.js";
import { SclBridge } from "../scl-bridge.js";
import { RV } from "../utils/constants.js";

export class NodeRenderer {
  public static renderNodeElement(
    node: Node, 
    targetContainer: HTMLElement, 
    isCenter: boolean,
    sclBridge: SclBridge
  ): HTMLElement {
    node.assignedArea = isCenter ? "center" : node.assignedArea;
    
    let itemDiv: HTMLElement | null = node.div;
      
    if (itemDiv) {
      itemDiv.innerHTML = "";
      itemDiv.className = "item"; 
    } else {
      itemDiv = createDiv({ cls: "item" }); 
      node.div = itemDiv;
    }

    if (node.isLooseRelation) {
      itemDiv.classList.add("rv-loose-relation");
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
    sclBridge.styleLinkElement(linkEl, node.file, node.displayText);

    node.friendGate.direction = node.assignedArea === "left" ? "right" : "left";
    
    const boundsEl: HTMLElement = targetContainer.closest(`.${RV.COLLECTION_WRAPPER}`) ?? targetContainer;

    node.upperGate.areaElement = boundsEl;
    node.lowerGate.areaElement = boundsEl;
    node.friendGate.areaElement = boundsEl;

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