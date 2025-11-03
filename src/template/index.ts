import { Environment } from "./minijinja-shim";
import { ContentLoaderFactory } from "../content-loader";
import { logVerbose } from "../logger";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export class TemplateRenderer {
	private env: Environment;
	private contentLoader: ContentLoaderFactory;

	constructor(githubToken?: string) {
		this.env = new Environment();
		this.contentLoader = new ContentLoaderFactory(githubToken);

		// Add custom filters
		this.addCustomFilters();
	}

	/**
	 * Add custom filters to the environment
	 */
	private addCustomFilters(): void {
		// Add extract filter to extract values from an object using keys from an array
		// Usage: keys | map('string') | map('extract', object)
		// Equivalent to: keys.map(key => object[key])
		this.env.addFilter('extract', (key: any, object: Record<string, any>) => {
			// When used with map, this filter receives individual keys, not an array
			if (!object || typeof object !== 'object') {
				return undefined;
			}
			return object[String(key)];
		});
	}

	async loadAndRender(
		templateSource: string,
		data: Record<string, unknown>,
	): Promise<string> {
		logVerbose(`[TemplateRenderer] Loading template from: ${templateSource}`);

		// Load template content using the content loader
		const templateContent = await this.contentLoader.load(templateSource);

		// Preload potential changelog include templates
		await this.preloadChangelogTemplates(data);

		logVerbose(`[TemplateRenderer] Template loaded, rendering with data`);

		// Register the main template with the environment
		const templateName = "__MAIN_TEMPLATE__";
		this.env.addTemplate(templateName, templateContent);

		// Render the template with the provided data
		const rendered = this.env.renderTemplate(templateName, data);

		logVerbose(`[TemplateRenderer] Template rendered successfully`);
		return rendered;
	}

	/**
	 * Preload potential changelog include templates into the environment
	 */
	private async preloadChangelogTemplates(
		data: Record<string, unknown>,
	): Promise<void> {
		const tag = this.extractTag(data);

		logVerbose(
			`[TemplateRenderer] Preloading changelog templates${tag ? ` for tag: ${tag}` : ""}`,
		);

		// Directories to scan for templates (in priority order: lowest to highest)
		const directories = [".changelog/templates"];

		const prevTag = this.extractPrevTag(data);
		if (prevTag) {
			directories.push(`.changelog/from-${prevTag}`);
		}

		if (tag) {
			directories.push(`.changelog/${tag}`);
		}

		// Load templates with priority (templates < from-tag < tag-specific)
		const templateMap = new Map<string, string>();

		// Load templates in order (lower priority first, higher priority overwrites)
		for (const directory of directories) {
			await this.loadTemplatesFromDirectory(directory, templateMap);
		}

		// Register all templates with the environment
		for (const [templateName, content] of templateMap) {
			this.env.addTemplate(templateName, content);
			logVerbose(`[TemplateRenderer] Registered template: ${templateName}`);
		}
	}

	/**
	 * Extract the tag from the data context
	 */
	private extractTag(data: Record<string, unknown>): string | null {
		// Try to get tag from release.tag first, then fallback to tag
		const release = data.release as Record<string, unknown> | undefined;
		if (release && typeof release.tag === "string") {
			return release.tag;
		}
		if (typeof data.tag === "string") {
			return data.tag;
		}
		return null;
	}

	/**
	 * Extract the previous tag from the data context
	 */
	private extractPrevTag(data: Record<string, unknown>): string | null {
		const lastRelease = data.lastRelease as Record<string, unknown> | undefined;
		if (lastRelease && typeof lastRelease.tag_name === "string") {
			return lastRelease.tag_name;
		}
		return null;
	}

	/**
	 * Load all templates from a directory
	 */
	private async loadTemplatesFromDirectory(
		directoryPath: string,
		templateMap: Map<string, string>,
	): Promise<void> {
		try {
			const resolvedDir = path.resolve(process.cwd(), directoryPath);
			const files = await fs.readdir(resolvedDir);

			for (const file of files) {
				// Skip hidden files and directories
				if (file.startsWith(".")) {
					continue;
				}

				try {
					const filePath = path.join(resolvedDir, file);

					// Check if it's actually a file (not a directory)
					const stat = await fs.stat(filePath);
					if (!stat.isFile()) {
						logVerbose(
							`[TemplateRenderer] Skipping ${directoryPath}/${file}: not a file`,
						);
						continue;
					}

					const content = await fs.readFile(filePath, "utf-8");

					// Use filename as template name (higher priority overwrites)
					templateMap.set(file, content);
					logVerbose(
						`[TemplateRenderer] Loaded template: ${directoryPath}/${file}`,
					);
				} catch (error) {
					logVerbose(
						`[TemplateRenderer] Failed to read ${directoryPath}/${file}: ${(error as Error).message}`,
					);
				}
			}
		} catch (error) {
			// Directory doesn't exist - this is expected
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				logVerbose(
					`[TemplateRenderer] Failed to read directory ${directoryPath}: ${(error as Error).message}`,
				);
			}
		}
	}
}
