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
		const templateName = "main_template";
		this.env.addTemplate(templateName, templateContent);

		// Render the template with the provided data
		const rendered = this.env.renderTemplate(templateName, data);

		logVerbose(`[TemplateRenderer] Template rendered successfully`);
		return rendered;
	}

	/**
	 * Preload potential changelog include templates into the environment
	 */
	private async preloadChangelogTemplates(data: Record<string, unknown>): Promise<void> {
		const tag = this.extractTag(data);
		if (!tag) {
			logVerbose(`[TemplateRenderer] No tag found in data, skipping changelog preload`);
			return;
		}

		logVerbose(`[TemplateRenderer] Preloading changelog templates for tag: ${tag}`);

		// List of potential include patterns to check
		const includePatterns = [
			// Tag-specific templates
			`.changelog/${tag}/header.md`,
			`.changelog/${tag}/header.md.jinja`,
			`.changelog/${tag}/body.md`,
			`.changelog/${tag}/body.md.jinja`,
			`.changelog/${tag}/footer.md`,
			`.changelog/${tag}/footer.md.jinja`,
			// From-tag templates (if there's a previous tag)
		];

		// Add from-tag patterns if there's a previous tag
		const prevTag = this.extractPrevTag(data);
		if (prevTag) {
			includePatterns.push(
				`.changelog/from-${prevTag}/header.md`,
				`.changelog/from-${prevTag}/header.md.jinja`,
				`.changelog/from-${prevTag}/body.md`,
				`.changelog/from-${prevTag}/body.md.jinja`,
				`.changelog/from-${prevTag}/footer.md`,
				`.changelog/from-${prevTag}/footer.md.jinja`,
			);
		}

		// Try to load each template and register it if it exists
		for (const pattern of includePatterns) {
			await this.tryLoadTemplate(pattern);
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
	 * Try to load a template file and register it with the environment if it exists
	 */
	private async tryLoadTemplate(templatePath: string): Promise<void> {
		try {
			const resolvedPath = path.resolve(process.cwd(), templatePath);
			const content = await fs.readFile(resolvedPath, "utf-8");

			// Register the template with a normalized name (replace path separators with dots)
			const templateName = templatePath.replace(/[\/\\]/g, ".");
			this.env.addTemplate(templateName, content);

			logVerbose(`[TemplateRenderer] Loaded include template: ${templatePath} as ${templateName}`);
		} catch (error) {
			// Silently ignore missing files - this is expected behavior
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				logVerbose(`[TemplateRenderer] Failed to load template ${templatePath}: ${(error as Error).message}`);
			}
		}
	}
}
