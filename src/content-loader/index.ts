import { LocalContentLoader } from "./local-content-loader";
import { HTTPSContentLoader } from "./https-content-loader";
import { PurlGitHubContentLoader } from "./purl-github-content-loader";
import { detectContentSource } from "./utils";
import { logVerbose } from "../logger";
import type { ContentLoader } from "./types";

export * from "./types";
export * from "./utils";

export class ContentLoaderFactory {
	private localLoader: LocalContentLoader;
	private httpsLoader: HTTPSContentLoader;
	private purlLoader?: PurlGitHubContentLoader;
	private githubToken?: string;

	constructor(githubToken?: string) {
		this.localLoader = new LocalContentLoader();
		this.httpsLoader = new HTTPSContentLoader();
		this.githubToken = githubToken;
		// Only create PurlGitHubContentLoader if token is provided
		if (githubToken) {
			this.purlLoader = new PurlGitHubContentLoader(githubToken);
		}
	}

	async load(source: string): Promise<string> {
		const contentSource = detectContentSource(source);
		logVerbose(
			`[ContentLoader] Detected source type: ${contentSource.type} (${contentSource.location})`,
		);

		let loader: ContentLoader;
		switch (contentSource.type) {
			case "local":
				loader = this.localLoader;
				break;
			case "https":
				loader = this.httpsLoader;
				break;
			case "purl":
				if (!this.purlLoader) {
					throw new Error(
						"GitHub token required for purl content. Set GITHUB_TOKEN, GH_TOKEN, or use 'gh auth login'",
					);
				}
				loader = this.purlLoader;
				break;
			default:
				throw new Error(
					`Unsupported content source type: ${contentSource.type as string}`,
				);
		}

		logVerbose(`[ContentLoader] Loading content...`);
		const content = await loader.load(contentSource.location);
		logVerbose(
			`[ContentLoader] Loaded content (${Math.min(content.length, 1024)} bytes shown, total ${content.length} bytes)`,
		);
		return content;
	}
}
