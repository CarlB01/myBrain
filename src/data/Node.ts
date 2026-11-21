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
}
