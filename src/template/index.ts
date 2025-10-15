import { Environment } from "./minijinja-shim";
import { ContentLoaderFactory } from "../content-loader";
import { logVerbose } from "../logger";

export class TemplateRenderer {
	private env: typeof Environment;
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

		logVerbose(`[TemplateRenderer] Template loaded, rendering with data`);

		// Render the template with the provided data
		const rendered = this.env.renderStr(templateContent, data);

		logVerbose(`[TemplateRenderer] Template rendered successfully`);
		return rendered;
	}
}
