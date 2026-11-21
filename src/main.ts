import { Plugin, Notice, WorkspaceLeaf, TFile, TAbstractFile, debounce, Debouncer, Platform } from 'obsidian';
import { SettingTab } from "./SettingTab.js";
import { MyBrainView } from './view/view.js';
import { RV } from './utils/constants.js';
import { SettingsManager } from './SettingsManager.js';
import { NetworkGraph } from './data/NetworkGraph.js';

export default class MyBrainPlugin extends Plugin {
  declare settings: SettingsManager;
  public networkGraph!: NetworkGraph;

  private appPaused: boolean = false;
  private resumedAt: number = 0;
  private mobileWarmupUntil: number = 0;

  public isAppPaused(): boolean {
    return this.appPaused;
  }

  public isInResumeCooldown(ms: number = 1200): boolean {
    return Date.now() - this.resumedAt < ms;
  }

  public markResumedNow(): void {
    this.resumedAt = Date.now();
    this.mobileWarmupUntil = this.resumedAt + 2000; 
  }

  public isInMobileWarmup(): boolean {
    return Date.now() < this.mobileWarmupUntil;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.networkGraph = new NetworkGraph(this, this.settings);

    this.addSettingTab(new SettingTab(this.app, this));
  
    this.registerView(
      RV.VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MyBrainView(leaf, this)
    );

    this.registerGlobalEvents();
    this.registerAppLifecycleEvents();

    this.addRibbonIcon(RV.ICON, "Open myBrain", () => {
      void this.activateGraphView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open view',
      callback: () => { void this.activateGraphView(); },
    });

    this.app.workspace.onLayoutReady(() => {
      this.activateGraphView();
    });
  }

  private registerGlobalEvents(): void {
    // A. FILE OPEN INTERCEPTOR
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (this.appPaused || !file) return;

        this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
          if (leaf.view instanceof MyBrainView) {
            leaf.view.onFileChange(file);
          }
        });
      })
    );

    // B. VAULT RENAME INTERCEPTOR
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (this.appPaused || !(file instanceof TFile)) return;

        if (this.networkGraph && this.networkGraph.noteCache) {
          this.networkGraph.noteCache.delete(oldPath);
          this.networkGraph.noteCache.delete(file.path);
        }

        this.networkGraph.handleFileRename(file, oldPath);

        this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
          if (leaf.view instanceof MyBrainView) {
            const myView: MyBrainView = leaf.view;
            if (!myView.isFullyStarted) return;

            if (oldPath === myView.currentFilePath) {
              myView.currentFilePath = file.path;
              this.networkGraph.update(file);
            }
          }
        });
      })
    );

    // C. METADATA RESOLVE INTERCEPTOR
    const debouncedGraphUpdate: Debouncer<[], void> = debounce(() => {
      const activeNow: TFile | null = this.app.workspace.getActiveFile();
      if (activeNow) {
        this.networkGraph.update(activeNow);
      }
    }, 250, true);

    this.registerEvent(
      this.app.metadataCache.on('resolve', (file: TFile) => {
        if (this.appPaused || this.isInResumeCooldown(1200) || this.isInMobileWarmup()) return;

        void this.networkGraph.handleFileResolve(file).then((påvirkerVisning: boolean) => {
          if (!påvirkerVisning) return; 

          this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
            if (leaf.view instanceof MyBrainView) {
              if (!leaf.view.isFullyStarted) return;
              debouncedGraphUpdate();
            }
          });
        });
      })
    );
    
    // D. REGISTER THE REACTIVE CONTROLTOWER EVENT + JIT COLOR UPDATE FOR SCL v1.0.0
    const debouncedRefresh: Debouncer<[], void> = debounce(() => {
      const activeFile: TFile | null = this.app.workspace.getActiveFile();
      if (activeFile) {
        void this.networkGraph.update(activeFile);
      }
    }, 250, true);
    
    this.registerEvent(
      this.app.metadataCache.on('changed', (file: TFile) => {
        if (this.networkGraph.isFileRelevantToCurrentGraph(file)) {
          // JIT SCL v1.0.0 Trigger: Hvis filen endres i bakgrunnen av SCL, ber vi bare AreaManager 
          // oppdatere eksisterende linjefarger umiddelbart i stedet for full render, for maksimal ytelse.
          this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
            if (leaf.view instanceof MyBrainView && leaf.view.areaManager) {
              leaf.view.areaManager.requestRedraw();
            }
          });
          debouncedRefresh();
        }
      })
    );

    // E. LISTEN FOR LIVE RULE/COLOR UPDATES FROM RE-SUPERCHARGED LINKS
    this.registerEvent(
      this.app.workspace.on("resupercharged-links:rules-changed" as "quit", () => {
        if (this.appPaused) return;

        const activeFile: TFile | null = this.app.workspace.getActiveFile();
        if (activeFile) {
          void this.networkGraph.update(activeFile);
        }
      })
    );
  }

  private registerAppLifecycleEvents(): void {
    const suspendAllViews = (): void => {
      if (!Platform.isMobile) return;

      this.appPaused = true;
      this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
        if (leaf.view instanceof MyBrainView) {
          leaf.view.suspendForBackground();
        }
      });
    };

    const resumeAllViews = (): void => {
      if (Date.now() - this.resumedAt < 300) return;
      
      const wasPaused = this.appPaused;
      this.appPaused = false;
      this.markResumedNow();

      this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
        if (leaf.view instanceof MyBrainView) {
          if (wasPaused || leaf.view.isSuspended) {
            leaf.view.resumeFromBackground();
          } else {
            // På macOS: Sikre at SVG-linjer og graf friskes opp etter dvale/fokus
            leaf.view.ensureGraphVisibleAfterWake();
          }
        }
      });
    };

    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) suspendAllViews();
      else resumeAllViews();
    });
    this.registerDomEvent(window, 'focus', () => resumeAllViews());
    this.registerDomEvent(window, 'pageshow', () => resumeAllViews());
  }

  async activateGraphView(): Promise<void> {
    const { workspace } = this.app;
    
    const leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(RV.VIEW_TYPE)[0];
    if (leaf) {
      void workspace.revealLeaf(leaf);
      return;
    }

    const newLeaf: WorkspaceLeaf | null = workspace.getLeftLeaf(false);

    if (newLeaf) {
      await newLeaf.setViewState({
        type: RV.VIEW_TYPE,
        active: true, 
      });
      
      void workspace.revealLeaf(newLeaf);
      if (workspace.leftSplit) workspace.leftSplit.expand();

      const activeFile: TFile | null = this.app.workspace.getActiveFile();
      if (activeFile && newLeaf.view instanceof MyBrainView) {
        newLeaf.view.onFileChange(activeFile);
      }
    } else {
      new Notice("Could not create view leaf");
    }
  }
  
  onunload(): void {
    this.appPaused = true;
    this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
      if (leaf.view instanceof MyBrainView) {
        leaf.view.suspendForBackground();
      }
    });
    if (this.networkGraph) this.networkGraph.cancel(); 
  }

  async loadSettings(): Promise<void> {
    this.settings = new SettingsManager();
    const loadedData: unknown = await this.loadData();
    
    if (loadedData && typeof loadedData === "object") {
      Object.assign(this.settings, loadedData);
    }
    
    this.settings.prepare();
  }
  
  async saveSettings(): Promise<void> {
    this.settings.prepareForSave();
    await this.saveData(this.settings);
  }
}
