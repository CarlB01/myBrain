import myBrainPlugin from '../main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, App, EventRef } from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV } from '../utils/constants.js';
import { ExternalFeederScanner } from '../ExternalFeeder.js';

// Import our isolated sub-managers
import { ViewFileResolver } from './ViewFileResolver.js';
import { ViewLifecycleManager } from './ViewLifecycleManager.js';
import { ViewLinkHandler } from './ViewLinkHandler.js';

export class MyBrainView extends ItemView implements HoverParent {
  private plugin: myBrainPlugin;
  public app: App;
  public areaManager!: AreaManager;
  
  public currentFilePath: string = ""; 
  public hoverPopover: HoverPopover | null = null;

  // Delegated structural tracking engines
  private fileResolver: ViewFileResolver;
  private lifecycleManager: ViewLifecycleManager;
  private linkHandler: ViewLinkHandler;

  private isDomSuspended: boolean = false;
  private lastResumeAt: number = 0;
  
  public isFullyStarted: boolean = false;
  public isSuspended: boolean = false;
  private wasPanelHidden: boolean = true;

  public getDisplayText(): string { return RV.DISPLAY_TEXT; }
  public getViewType(): string { return RV.VIEW_TYPE; }
  override getIcon(): string { return RV.ICON; } 
  
  constructor(leaf: WorkspaceLeaf, plugin: myBrainPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;

    // Instantiate sub-managers inside the boundary constructor
    this.fileResolver = new ViewFileResolver(this.app);
    this.lifecycleManager = new ViewLifecycleManager(this);
    this.linkHandler = new ViewLinkHandler(this);
  }
  
  override onResize(): void {
    super.onResize();
    if (this.areaManager) this.areaManager.requestRedraw();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    
    this.areaManager = new AreaManager(this.plugin.networkGraph, this.contentEl, this.plugin);
    this.areaManager.initiate();

    this.registerWorkspaceLayoutChanges();
    this.lifecycleManager.registerZoomObservers();
    this.registerHoverLinkSource();
    this.setupDataReadyHandler(); 
    this.setupMobileSafeguards();
    this.lifecycleManager.setupVisibilityObserver(this.areaManager.containerEl);
    this.linkHandler.registerEvents(this.contentEl, this);
    this.setupBackgroundTapClear();
  
    this.displayWelcome();

    const isCacheReady: boolean = "initialized" in this.app.metadataCache && 
      (this.app.metadataCache as { initialized?: boolean }).initialized === true;
    
    if (isCacheReady) {
      this.isFullyStarted = true;
      this.wasPanelHidden = false; 
      
      const activeFile: TFile | null = this.getMostRecentMarkdownFile();
      if (activeFile) this.onFileChange(activeFile);
    } else {

      this.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          if (this.isFullyStarted) return; 
          this.lifecycleManager.debouncedResolve();
        })
      );
    }
  }

  async onClose(): Promise<void> {
    this.lifecycleManager.cancelAll(); 
    if (this.plugin.networkGraph) this.plugin.networkGraph.cancel(); 
    if (this.areaManager) this.areaManager.destroy(); 

    this.teardownDomForSuspend();
    this.lifecycleManager.disconnectObserver();
  }

  public suspendForBackground(): void {
    this.isSuspended = true;
    this.lifecycleManager.cancelAll();
    if (this.plugin.networkGraph) this.plugin.networkGraph.cancel();

    if (this.areaManager) this.areaManager.destroy();
    this.teardownDomForSuspend();
  }

  public resumeFromBackground(): void {
    const now: number = Date.now();
    if (now - this.lastResumeAt < 1200) return;
    this.lastResumeAt = now;

    this.isSuspended = false;
    this.restoreDomAfterSuspend();
    if (!this.isFullyStarted) return;

    const activeFile: TFile | null = this.getMostRecentMarkdownFile();
    if (!activeFile) return;
    
    this.lifecycleManager.debouncedVisibilityResume();
  }

  public onFileChange(file: TFile | null): void {
    if (!file || this.isSuspended || !this.isFullyStarted) return;
    this.currentFilePath = file.path; 
    this.plugin.networkGraph.update(file);
  }

  // #region STATE HOOKS CALLED BY SUB-MANAGERS
  public setPanelHiddenState(hidden: boolean): void {
    this.wasPanelHidden = hidden;
  }

  public handleViewportIntersection(): void {
    if (!this.isFullyStarted || !this.wasPanelHidden) return;
    this.wasPanelHidden = false;

    const activeFile: TFile | null = this.getMostRecentMarkdownFile();
    if (activeFile) {
      if (activeFile.path !== this.currentFilePath && this.areaManager?.containerEl) {
        this.areaManager.containerEl.className = "view-content rv-container is-calculating";
      }
      this.isFullyStarted = true; 
      this.onFileChange(activeFile);
    }
    void this.lifecycleManager.debouncedVisibilityResume();
  }

  public async handleLinkClick(path: string): Promise<void> {
    const selectedFile: TFile | null = this.fileResolver.getFile(path);
    if (!selectedFile) return;

    const currentCenter = this.plugin.networkGraph.centerNote;
    if (currentCenter && currentCenter.path === selectedFile.path) {      
      if (this.areaManager) this.areaManager.requestRedraw(); 
      return; 
    }

    this.clearTouchHoverState();
    await this.openLinkInAdjacentPane(path);
    this.onFileChange(selectedFile);
  }
  // #endregion

  // #region DEBOUNCE TARGET IMPLEMENTATIONS
  public executeActiveLeafChange(): void {
    if (this.isSuspended || !this.isFullyStarted) return;

    const activeFile: TFile | null = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    if (activeFile.path.endsWith(".mdenc")) {
      const virtualCache = ExternalFeederScanner.scanActiveView(this.app);
      if (virtualCache) this.plugin.networkGraph.handleExternalContentFeed(activeFile, virtualCache);
    } else {
      this.plugin.networkGraph.clearMemoryFeederCache();
    }

    const targetFile: TFile | null = activeFile.path.endsWith(".mdenc") ? activeFile : this.getMostRecentMarkdownFile();
    if (targetFile !== null && targetFile.path !== this.currentFilePath) {
      this.onFileChange(targetFile);
    }
  }

  public executeResolve(): void {
    if (this.isFullyStarted) return; 
    this.isFullyStarted = true; 
    this.wasPanelHidden = false;
    const activeFile = this.getMostRecentMarkdownFile();
    if (activeFile) this.onFileChange(activeFile);
  }

  public async executeVisibilityResume(): Promise<void> {
    if (this.isSuspended) return;
    const activeFile = this.getMostRecentMarkdownFile();
    if (!activeFile) return;

    this.onFileChange(activeFile);
    window.requestAnimationFrame(() => { if (this.areaManager) this.areaManager.requestRedraw(); });
  }

  public executeLayoutRefresh(): void { if (this.areaManager) this.areaManager.requestRedraw(); }
  public executeOrientationChange(): void { if (this.areaManager) this.areaManager.requestRedraw(); }
  // #endregion

  // #region DOM SETUP AND AUXILIARY METHODS
  private teardownDomForSuspend(): void {
    if (this.isDomSuspended || !this.contentEl) return;
    this.contentEl.empty();
    this.isDomSuspended = true;
  }

  private restoreDomAfterSuspend(): void {
    if (!this.isDomSuspended || !this.contentEl) return;
    this.areaManager = new AreaManager(this.plugin.networkGraph, this.contentEl, this.plugin);
    this.areaManager.initiate();
    this.isDomSuspended = false;
  }

  private registerWorkspaceLayoutChanges(): void {
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if (this.isSuspended || !this.isFullyStarted) return;
      this.lifecycleManager.debouncedLayout();
    }));
  }

  private registerHoverLinkSource(): void {
    this.plugin.registerHoverLinkSource(RV.VIEW_TYPE, { display: 'My custom Hover', defaultMod: false });
  }

  /**
   * Multiview Isolation Bus: Captures central data-ready broadcasts from NetworkGraph.
   * Uses a safe double-casting layout pattern to bypass strict index-signature validation boundaries.
   */
  private setupDataReadyHandler(): void {
    interface GraphDataReadyBus { 
      on(name: "graph:data-ready", callback: (cleanedPath: unknown) => void): EventRef; 
    }

    // Vi tvinger den trygt via 'unknown' først for å tilfredsstille kompilatorens strenge overlap-sjekk
    const workspaceBus = (this.app.workspace as unknown) as Partial<GraphDataReadyBus>;
    
    if (workspaceBus.on) {
      this.registerEvent(
        workspaceBus.on("graph:data-ready", (cleanedPath: unknown) => {
          if (typeof cleanedPath === "string") {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && activeFile.path === cleanedPath) {
              this.currentFilePath = activeFile.path;
              if (this.areaManager) this.areaManager.renderGraph();
            }
          }
        })
      );
    }
  }

  private setupMobileSafeguards(): void {
    if (!Platform.isMobile || !this.areaManager?.containerEl) return;
    const leftSplit = this.areaManager.containerEl.closest('.mod-left-split') as HTMLElement | null;
    if (leftSplit) {
      this.registerDomEvent(leftSplit, 'transitionend', (e: TransitionEvent) => {
        if ((e.propertyName === 'transform' || e.propertyName === 'width') && this.areaManager) {
          this.areaManager.requestRedraw(); 
        }
      });
    }
    this.registerDomEvent(window, 'orientationchange', () => {
      if (!this.isSuspended) this.lifecycleManager.debouncedOrientation();
    });
  }

  private setupBackgroundTapClear(): void {
    this.contentEl.on('click', '*', (event: MouseEvent) => {
      if (!Platform.isMobile || !event.target) return;
      const rawTarget = event.target as HTMLElement;
      if (!rawTarget.closest(`.${RV.A}`) && !rawTarget.closest('.rv-plusminus')) {
        if (!this.isSuspended && this.isFullyStarted) this.clearTouchHoverState();
      }
    });
  }

  private displayWelcome(): void {
    if (!this.areaManager?.containerEl) return;
    this.areaManager.containerEl.empty(); 
    const welcomeDiv = this.areaManager.containerEl.createDiv({ cls: "rv-welcome-container" });
    welcomeDiv.createEl("p", { text: RV.WELCOME, cls: "rv-welcome-text" });
  }

  /**
   * Intelligently dispatches a file open routing cycle targeting adjacent split editor panes.
   * Leverages active history maps to safely locate the most recently active container view.
   * 
   * @param filename The raw target filename text to navigate towards.
   */
  private async openLinkInAdjacentPane(filename: string): Promise<void> {
    const file: TFile | null = this.fileResolver.getFile(filename);
    if (!file || !this.plugin.networkGraph.centerNote) return;
    
    const oldCenterFile: TFile | null = this.app.vault.getFileByPath(this.plugin.networkGraph.centerNote.path);
    if (!oldCenterFile) return;
    
    let targetLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (leaf.view instanceof FileView && leaf.view.file?.path === oldCenterFile.path) {
        targetLeaf = leaf;
      }
    });

    if (!targetLeaf) {
      const recentLeaf: WorkspaceLeaf | null = this.app.workspace.getMostRecentLeaf();
      if (recentLeaf && ['empty', 'markdown'].contains(recentLeaf.view.getViewType())) {
        targetLeaf = recentLeaf;
      }
    }

    if (!targetLeaf) {
      targetLeaf = this.app.workspace.getLeaf('split', 'vertical');
    }

    await targetLeaf.openFile(file);
    await this.app.workspace.revealLeaf(targetLeaf);
    
    const leaves: WorkspaceLeaf[] = this.app.workspace.getLeavesOfType(RV.VIEW_TYPE);
    const firstLeaf: WorkspaceLeaf | undefined = leaves[0];
    if (firstLeaf !== undefined) {
      await this.app.workspace.revealLeaf(firstLeaf);
      this.app.workspace.setActiveLeaf(firstLeaf);
    }
  }

  /**
   * Extracts the most recently focused active markdown document instance from workspace layout maps.
   * Synchronizes via sorting active time properties on open viewports.
   * 
   * @returns The active TFile instance representing the most recently active markdown node, or null.
   */
  private getMostRecentMarkdownFile(): TFile | null {
    const mdLeaves: WorkspaceLeaf[] = this.app.workspace.getLeavesOfType('markdown');
    if (mdLeaves.length === 0) return null;

    type TimedLeaf = WorkspaceLeaf & { activeTime?: number };
    mdLeaves.sort((a: WorkspaceLeaf, b: WorkspaceLeaf) => {
      const timeA: number = (a as TimedLeaf).activeTime ?? 0;
      const timeB: number = (b as TimedLeaf).activeTime ?? 0;
      return timeB - timeA;
    });

    const mostRecentLeaf: WorkspaceLeaf | undefined = mdLeaves[0];
    if (mostRecentLeaf && mostRecentLeaf.view instanceof MarkdownView) {
      return mostRecentLeaf.view.file; 
    }

    return null;
  }

  /**
   * Synchronously clears all active visual highlights and temporary mobile neighbor states with zero memory heap allocations.
   */
  private clearTouchHoverState(): void {
    const stuck: NodeListOf<HTMLElement> = this.contentEl.querySelectorAll(
      `.${RV.A}.is-hover-hovered, .${RV.A}.is-hover-handled, .item.is-hover-neighbor, .item.is-pressed-origin`
    );
    stuck.forEach((el: HTMLElement) => el.classList.remove("is-hover-neighbor", "is-pressed-origin", "is-hovered"));
    
    this.linkHandler.flushMousePointers();
    if (this.areaManager) {
      this.areaManager.clearTransientHoverState();
    }
  }
  // #endregion
}
