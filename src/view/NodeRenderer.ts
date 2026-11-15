import { Node } from "../Node.js";
import { RV } from "../constants.js";

export class NodeRenderer {
  /**
   * Generates or safely recycles individual target node elements inside the visual scope.
   * Restores the flat, high-performance link architecture with updated SCL v1.0.0 tag formatting.
   * Guaranteed 0% any and 0% undefined.
   */
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

    // SCL v1.0.0 Format: Sørg for at taggene skrives med '#' separert med mellomrom ("#him #lege")
    const formattedTags: string = node.tags 
      ? node.tags.map((t: string) => t.startsWith('#') ? t : `#${t}`).join(' ') 
      : "";

    // SCL v1.0.0 Klasser: Stripp '#' fra klassenavnene for å unngå CSS-kræsj
    const sclSemanticClasses: string = node.tags
      ? node.tags.map((t: string) => `scl-match-tag-${t.startsWith('#') ? t.slice(1) : t}`).join(' ')
      : "";

    // 2. Native link mimicry block
    // Går tilbake til den flate strukturen der .data-link-text bor direkte på <a>-taggen
    const linkEl: HTMLAnchorElement = createEl('a', { 
        cls: `internal-link ${RV.SUPERCHARGED_ATTRIB} ${RV.A} ${sclSemanticClasses}`.trim(),
        attr: {
            'data-href': routingPath,
            'href': routingPath,
            'data-link-path': node.path,
            'data-link-tags': formattedTags, // Perfekt SCL-matching: "#him #lege"
            'draggable': 'true',
            'rel': 'noopener'
        }
    });

    // Teksten legges direkte inn i <a>-taggen
    linkEl.textContent = node.displayText;

    if (node.assignedArea === "left") {
      node.friendGate.direction = 'right';
    } else {
      node.friendGate.direction = 'left';
    }
    
    if (node.upperGate) node.upperGate.areaElement = targetContainer;
    if (node.lowerGate) node.lowerGate.areaElement = targetContainer;
    if (node.friendGate) node.friendGate.areaElement = targetContainer;

    const topSVG: SVGSVGElement = node.upperGate.render();
    const bottomSVG: SVGSVGElement = node.lowerGate.render();
    const friendSVG: SVGSVGElement = node.friendGate.render();
    
    node.upperGate.svg  = topSVG;
    node.lowerGate.svg  = bottomSVG;
    node.friendGate.svg = friendSVG;
    
    linkWrapper.appendChild(topSVG);
    linkWrapper.appendChild(bottomSVG);
    
    if (node.friendGate.direction === 'left') {
      linkWrapper.appendChild(friendSVG); 
      linkWrapper.appendChild(linkEl);  
    } else {
      linkWrapper.appendChild(linkEl);  
      linkWrapper.appendChild(friendSVG); 
    }

    return itemDiv;
  }
}
