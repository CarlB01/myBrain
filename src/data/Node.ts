import { TFile, CachedMetadata, parseFrontMatterAliases, parseFrontMatterTags } from "obsidian";
import { RV } from "../utils/constants.js";
import { StringUtils } from "../utils/StringUtils.js";
import { Anchor } from "./Anchor.js";
import { Relation } from "./RelationClassifier.js";
import { Gate } from "./Gate.js";

const EMPTY_FROZEN_CLASSES: readonly string[] = Object.freeze([]);

export class Node {  
  public readonly file: TFile; // Lagre TFile-referansen for O(1) batch-innsending
  public path: string; // updates if user renames a node 
  public basename: string;
  public normalizedBasename: string;
  public displayText: string;

  readonly aliases: string[];
  readonly tags: string[]; // Sanitized in lowercase keys for high-velocity O(1) matching passes  
  readonly rawFrontmatter: import("obsidian").FrontMatterCache | null;
  
  readonly isInitiallyIgnored: boolean;
  
  
  public connectionCount: number = 0;
  public sharedLinksWithStart: number = 0;
  public info: string = "";
  
  public isUsed: boolean = false; // Lifecycle flag managing item element instance recycling
  public isIndexedInThisRound: boolean = false; // Typesafe JIT pass flag tracking JIT passes safely
  
  // Evaluation stamps instructing rendering quadrants and structural collection buckets
  public relation: Relation = "undefined";
  public discoverySource: "frontmatter-kriterium" | "frontmatter-udefinert" | "bodytext" = "bodytext";
  public assignedArea: "upper" | "lower" | "left" | "right" | "center" | "ignored" = "lower";
  
  // Connections memory arrays
  public crossingBaits = new Set<Anchor>();
  
  // Anchor port definitions
  public upperGate: Gate;
  public lowerGate: Gate;
  public friendGate: Gate;
  
  public linkDivRef: HTMLElement | null = null;
  public div: HTMLElement | null = null;
  
  // Specialized structural memory sets
  public relations = {
    parents: new Set<Node>(),
    children: new Set<Node>(),
    friends: new Set<Node>(),
    ignored: new Set<Node>()
  };

  // Monomorfe Flyweight-felter (initialiseres med faste typer i constructor for V8)
  public sclHasMatch: boolean = false;
  public sclSignature: string = "";
  public sclColor: string = "";
  public sclBgColor: string = "";
  public sclIconBefore: string = "";
  public sclIconAfter: string = "";
  public sclClasses: readonly string[] = EMPTY_FROZEN_CLASSES;


  constructor(
    file:TFile,
    path: string, 
    basename: string, 
    displayText: string, 
    aliases: string[], 
    tags: string[], 
    isInitiallyIgnored: boolean,
    frontmatter: import("obsidian").FrontMatterCache | null,
    normalizedBasename: string
  ) {
    this.file = file;
    this.path = path;
    this.basename = basename;
    this.displayText = displayText;
    this.aliases = aliases;
    this.tags = tags;
    this.isInitiallyIgnored = isInitiallyIgnored;
    this.rawFrontmatter = frontmatter;
    this.normalizedBasename = normalizedBasename; 

    this.upperGate  = new Gate(this, 'up');
    this.lowerGate  = new Gate(this, 'down');
    this.friendGate = new Gate(this, 'left');
  }

  /**
   * Static factory builder parsing core Obsidian structures to compile concrete Node models.
   */
  public static createFromObsidian(
    file: TFile, 
    cache: CachedMetadata, 
    useAlias: boolean,
    optIgnoreFragments: Set<string>,
    optIgnoreTags: Set<string>,
  ): Node {
    const path = file.path;
    const basename = file.basename;
    const frontmatter = cache.frontmatter || null;

    const normalizedBasename = basename.toLowerCase().normalize('NFC');

    const nativeAliases = parseFrontMatterAliases(frontmatter) ?? [];
    const nativeTags = parseFrontMatterTags(frontmatter) ?? [];
    const cleanLowercaseTags = nativeTags.map(tag => tag.trim().toLowerCase());

    const displayText = useAlias ? (nativeAliases?.[0] ?? basename) : basename;

    const isIgnored = StringUtils.foundPart(path, optIgnoreFragments) || 
                      StringUtils.hasAnyOf(cleanLowercaseTags, optIgnoreTags);

    return new Node(file, path, basename, displayText, nativeAliases, cleanLowercaseTags, isIgnored, frontmatter, normalizedBasename);
  }

  /**
   * Generates or safely recycles individual target node elements inside the physical DOM window.
   * Handles relative direction adjustments dynamically preceding element appending.
   */
  public render(): HTMLElement {
    let itemDiv = this.div;
      
    // 1. REUSE OR CREATE STATE
    if (itemDiv) {
      itemDiv.innerHTML = "";
      itemDiv.className = "item"; 
    } else {
      itemDiv = createDiv({ cls: "item"}); 
      this.div = itemDiv;
    }

    const linkWrapper = itemDiv.createDiv({ cls: RV.LINKDIV });

    const linkEl = createEl('a', { 
        cls: `internal-link ${RV.A}`,
        attr: {
            'data-href': this.path,
            'draggable': 'true',
            'data-link-tags': this.tags.length > 0 ? this.tags.join(' ') : ""
        }
    });

    // Hvis Re-Supercharged Links allerede har levert flyweight-data: stemple elementet ferdig i minnet!
    if (this.sclHasMatch) {
      linkEl.classList.add("scl-processed");
      const clsLen = this.sclClasses.length;
      for (let i = 0; i < clsLen; i++) {
        const cls = this.sclClasses[i];
        if (cls !== undefined) linkEl.classList.add(cls);
      }
      linkEl.setAttribute("data-scl-signature", this.sclSignature);
      if (this.sclColor.length > 0) linkEl.style.setProperty("--scl-color", this.sclColor);
      if (this.sclBgColor.length > 0 && this.sclBgColor !== "transparent") {
        linkEl.style.setProperty("--scl-bg", this.sclBgColor);
      }
      if (this.sclIconBefore.length > 0) {
        linkEl.style.setProperty("--scl-icon-before", `"${this.sclIconBefore}"`);
      }
      if (this.sclIconAfter.length > 0) {
        linkEl.style.setProperty("--scl-icon-after", `"${this.sclIconAfter}"`);
      }
    }

    linkEl.createSpan( { text: this.displayText, cls: 'rv-text-span'} );

    // 3. EVALUATE GEOMETRICAL GATE ORIENTATION
    if (this.assignedArea === "left") {
      this.friendGate.direction = 'right'; // Routes friend links inward toward the center layout axis
    } else {
      this.friendGate.direction = 'left';  // Standard default for upper, lower, and core nodes
    }
    
    // 4. INJECT THREE INDIVIDUAL PORT VECTOR ELEMENTS
    const topSVG    = this.upperGate.render();
    const bottomSVG = this.lowerGate.render();
    const friendSVG = this.friendGate.render();
    
    this.upperGate.svg  = topSVG;
    this.lowerGate.svg  = bottomSVG;
    this.friendGate.svg = friendSVG;
    
    linkWrapper.appendChild(topSVG);
    linkWrapper.appendChild(bottomSVG);
    
    if (this.friendGate.direction == 'left') {
      linkWrapper.appendChild(friendSVG); 
      linkWrapper.appendChild(linkEl);  
    } else {
      linkWrapper.appendChild(linkEl);  
      linkWrapper.appendChild(friendSVG); 
    }

    this.linkDivRef = linkWrapper; 

    return itemDiv;
  }
}
