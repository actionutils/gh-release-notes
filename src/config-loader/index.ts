import { LocalConfigLoader } from "./local-config-loader";
import { HTTPSConfigLoader } from "./https-config-loader";
import { PurlGitHubConfigLoader } from "./purl-github-config-loader";
import { detectConfigSource } from "./utils";
import { logVerbose } from "../logger";
import type { ConfigLoader } from "./types";

export * from "./types";
export * from "./utils";

export class ContentLoaderFactory {
	private localLoader: LocalConfigLoader;
	private httpsLoader: HTTPSConfigLoader;
	private purlLoader?: PurlGitHubConfigLoader;
	private githubToken?: string;

	constructor(githubToken?: string) {
		this.localLoader = new LocalConfigLoader();
		this.httpsLoader = new HTTPSConfigLoader();
		this.githubToken = githubToken;
		// Only create PurlGitHubConfigLoader if token is provided
		if (githubToken) {
			this.purlLoader = new PurlGitHubConfigLoader(githubToken);
		}
	}

	async load(source: string): Promise<string> {
		const configSource = detectConfigSource(source);
		logVerbose(
			`[ContentLoader] Detected source type: ${configSource.type} (${configSource.location})`,
		);

		let loader: ConfigLoader;
		switch (configSource.type) {
			case "local":
				loader = this.localLoader;
				break;
			case "https":
				loader = this.httpsLoader;
				break;
			case "purl":
				if (!this.purlLoader) {
					throw new Error(
						"GitHub token required for purl configs. Set GITHUB_TOKEN, GH_TOKEN, or use 'gh auth login'",
					);
				}
				loader = this.purlLoader;
				break;
			default:
				throw new Error(
					`Unsupported config source type: ${configSource.type as string}`,
				);
		}

		logVerbose(`[ContentLoader] Loading content...`);
		const content = await loader.load(configSource.location);
		logVerbose(
			`[ContentLoader] Loaded content (${Math.min(content.length, 1024)} bytes shown, total ${content.length} bytes)`,
		);
		return content;
	}
}

// Backward compatibility alias
export const ConfigLoaderFactory = ContentLoaderFactory;
