import { App, TFile, CachedMetadata } from 'obsidian';

export class ViewFileResolver {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * High-velocity file resolver parsing incoming strings using multi-layered fallbacks.
   * Accesses cached indices natively to guarantee fast, disk-free string matching.
   * 
   * @param filename The raw link path string or target file name.
   * @param sourcePath Originating container pathway hash used to resolve relative targets.
   * @returns The resolved TFile instance, or null if no match is identified.
   */
  public getFile(filename: string, sourcePath: string = ''): TFile | null {
    if (!filename || !filename.trim()) return null;

    const cleanName: string = filename.trim();

    // 1. Primary path: Metadata cache direct linkpath destinations
    let file: TFile | null = this.app.metadataCache.getFirstLinkpathDest(cleanName, sourcePath);
    if (file instanceof TFile) return file;

    // 2. Secondary path: Direct vault file path lookups
    file = this.app.vault.getFileByPath(cleanName);
    if (file instanceof TFile) return file;

    // 3. Tertiary path: Automatically append markdown extensions if absent
    if (!cleanName.endsWith('.md') && !cleanName.includes('.')) {
      file = this.app.vault.getFileByPath(cleanName + '.md');
      if (file instanceof TFile) return file;
    }

    // 4. Quaternary path: Complete scanning across all valid markdown files
    const markdownFiles: TFile[] = this.app.vault.getMarkdownFiles();
    const foundByBasename: TFile | undefined = markdownFiles.find((f: TFile) => f.basename === cleanName);
    if (foundByBasename instanceof TFile) return foundByBasename;

    // 5. Final fallback path: Deep scan across alias metadata schemas
    const foundByAlias: TFile | undefined = markdownFiles.find((f: TFile) => {
      const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(f);
      const frontmatterIndex: Record<string, unknown> | null = (cache?.frontmatter || null) as Record<string, unknown> | null;
      const aliases: unknown = frontmatterIndex?.aliases;

      if (Array.isArray(aliases)) {
        return aliases.some((alias: unknown) => 
          typeof alias === 'string' && 
          alias.trim().toLowerCase() === cleanName.toLowerCase()
        );
      }
      if (typeof aliases === 'string') {
        return aliases.trim().toLowerCase() === cleanName.toLowerCase();
      }
      return false;
    });

    if (foundByAlias instanceof TFile) return foundByAlias;
    return null;
  }
}
