import { App, TFile } from "obsidian";

export interface ExternalNodeStyleFlyweight {
	readonly hasMatch: boolean;
	readonly signature: string;
	readonly color: string;
	readonly backgroundColor: string;
	readonly iconBefore: string;
	readonly iconAfter: string;
	readonly classes: readonly string[];
	readonly tags: readonly string[];
}

interface ResuperchargedFlyweightEngineApi {
	resolveBatchForExternal(
		files: readonly TFile[],
		budgetMs?: number
	): Promise<Map<string, ExternalNodeStyleFlyweight>>;
}

interface ResuperchargedPluginApi {
	readonly flyweightEngine: ResuperchargedFlyweightEngineApi;
}

const SCL_PLUGIN_ID = "re-supercharged-links";
const EMPTY_STYLE_MAP: Map<string, ExternalNodeStyleFlyweight> = new Map();

function isResuperchargedPlugin(candidate: unknown): candidate is ResuperchargedPluginApi {
	if (typeof candidate !== "object" || candidate === null) return false;
	if (!("flyweightEngine" in candidate)) return false;

	const engine = (candidate as { readonly flyweightEngine: unknown }).flyweightEngine;
	if (typeof engine !== "object" || engine === null) return false;

	return (
		"resolveBatchForExternal" in engine &&
		typeof (engine as { readonly resolveBatchForExternal: unknown }).resolveBatchForExternal === "function"
	);
}

export class SclBridge {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	private getEngine(): ResuperchargedFlyweightEngineApi | null {
		if (!this.app.plugins?.enabledPlugins.has(SCL_PLUGIN_ID)) return null;

		const rawPlugin: unknown = this.app.plugins.plugins[SCL_PLUGIN_ID] ?? null;
		if (!isResuperchargedPlugin(rawPlugin)) return null;

		return rawPlugin.flyweightEngine;
	}

	public isAvailable(): boolean {
		return this.getEngine() !== null;
	}

	public async resolveBatch(
		files: readonly TFile[],
		budgetMs = 5
	): Promise<Map<string, ExternalNodeStyleFlyweight>> {
		if (files.length === 0) return EMPTY_STYLE_MAP;

		const engine = this.getEngine();
		if (engine === null) return EMPTY_STYLE_MAP;

		return engine.resolveBatchForExternal(files, budgetMs);
	}
}
