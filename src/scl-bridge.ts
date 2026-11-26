// myBrain: src/scl-bridge.ts

import { App, TFile } from "obsidian";

export interface SclPresentationPool {
	readonly hasMatch: boolean;
	readonly signature: string;
	readonly color: string;
	readonly backgroundColor: string;
	readonly classesCount: number;
	readonly stylesCount: number;
	readonly classes: readonly string[];
	readonly styleKeys: readonly string[];
	readonly styleValues: readonly string[];
}

interface ResuperchargedFlyweightEngineApi {
	prepareLinkPresentation(file: TFile, visibleText: string): SclPresentationPool;
	prepareBatchForExternal<T>(
		items: Iterable<T>,
		getFile: (item: T) => TFile,
		getVisibleText: (item: T) => string,
		onItemPrepared: (item: T, pool: SclPresentationPool) => void,
		budgetMs?: number
	): Promise<void>;
}

interface ResuperchargedPluginApi {
	readonly flyweightEngine: ResuperchargedFlyweightEngineApi;
	applyPoolToLink?(link: HTMLElement, pool: SclPresentationPool): void;
}

const SCL_PLUGIN_ID = "re-supercharged-links";

function isResuperchargedPlugin(candidate: unknown): candidate is ResuperchargedPluginApi {
	if (typeof candidate !== "object" || candidate === null) return false;
	if (!("flyweightEngine" in candidate)) return false;

	const engine = (candidate as { readonly flyweightEngine: unknown }).flyweightEngine;
	if (typeof engine !== "object" || engine === null) return false;

	return (
		"prepareBatchForExternal" in engine &&
		typeof (engine as { readonly prepareBatchForExternal: unknown }).prepareBatchForExternal === "function" &&
		"prepareLinkPresentation" in engine &&
		typeof (engine as { readonly prepareLinkPresentation: unknown }).prepareLinkPresentation === "function"
	);
}
export class SclBridge {
	private readonly app: App;
	private cachedPlugin: ResuperchargedPluginApi | null = null;

	constructor(app: App) {
		this.app = app;
	}

	public clear(): void {
		this.cachedPlugin = null;
	}

	private getPlugin(): ResuperchargedPluginApi | null {
		if (!this.app.plugins?.enabledPlugins.has(SCL_PLUGIN_ID)) {
			this.cachedPlugin = null;
			return null;
		}

		if (this.cachedPlugin !== null) {
			return this.cachedPlugin;
		}

		const rawPlugin: unknown = this.app.plugins.plugins[SCL_PLUGIN_ID] ?? null;
		if (!isResuperchargedPlugin(rawPlugin)) return null;

		this.cachedPlugin = rawPlugin;
		return rawPlugin;
	}
	
	public isAvailable(): boolean {
		return this.getPlugin() !== null;
	}

	/**
	 * Varmer opp SCL-cachen og fyller ut node-felter direkte via SHARED_PRESENTATION_POOL
	 * innenfor et tidsbudsjett på `budgetMs` per frame (0 heap-allokering).
	 */
	public async prepareBatch<T>(
		items: Iterable<T>,
		getFile: (item: T) => TFile,
		getVisibleText: (item: T) => string,
		onItemPrepared: (item: T, pool: SclPresentationPool) => void,
		budgetMs = 5
	): Promise<void> {
		const plugin = this.getPlugin();
		if (plugin === null) return;

		await plugin.flyweightEngine.prepareBatchForExternal(
			items,
			getFile,
			getVisibleText,
			onItemPrepared,
			budgetMs
		);
	}

	/**
	 * Påfører ferdig populert pool direkte på et HTML-element og merker det med
	 * "scl-processed" + "data-scl-signature" så Re-Supercharged Links skipper det senere.
	 */
	public applyPoolToLink(linkEl: HTMLElement, pool: SclPresentationPool): void {
		const plugin = this.getPlugin();
		if (plugin?.applyPoolToLink) {
			plugin.applyPoolToLink(linkEl, pool);
		}
	}

	/**
	 * On-demand styling når MyBrain oppretter et DOM-element etter at batchen har kjørt.
	 * Bruker den allerede oppvarmede cachen (~1–2 µs) og stempler elementet som ferdig.
	 */
	public styleLinkElement(linkEl: HTMLElement, file: TFile, visibleText: string): void {
		const plugin = this.getPlugin();
		if (plugin === null) return;

		const pool = plugin.flyweightEngine.prepareLinkPresentation(file, visibleText);
		if (plugin.applyPoolToLink) {
			plugin.applyPoolToLink(linkEl, pool);
		}
	}
}
