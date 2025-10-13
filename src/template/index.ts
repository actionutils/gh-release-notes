import { Environment } from "minijinja-js";
import { ConfigLoaderFactory } from "../config-loader";
import { logVerbose } from "../logger";

export class TemplateRenderer {
	private env: Environment;
	private configLoaderFactory: ConfigLoaderFactory;

	constructor(githubToken?: string) {
		this.env = new Environment();
		this.configLoaderFactory = new ConfigLoaderFactory(githubToken);
	}

	async loadAndRender(templateSource: string, data: any): Promise<string> {
		logVerbose(`[TemplateRenderer] Loading template from: ${templateSource}`);

		// Load template content using the same loader as config
		const templateContent = await this.configLoaderFactory.load(templateSource);

		logVerbose(`[TemplateRenderer] Template loaded, rendering with data`);

		// Render the template with the provided data
		const rendered = this.env.renderStr(templateContent, data);

		logVerbose(`[TemplateRenderer] Template rendered successfully`);
		return rendered;
	}
}
