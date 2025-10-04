import { LocalConfigLoader } from "./local-config-loader";
import { HTTPSConfigLoader } from "./https-config-loader";
import { PurlGitHubConfigLoader } from "./purl-github-config-loader";
import { detectConfigSource } from "./utils";
import type { ConfigLoader } from "./types";

export * from "./types";
export * from "./utils";

export class ConfigLoaderFactory {
	private localLoader: LocalConfigLoader;
	private httpsLoader: HTTPSConfigLoader;
	private purlLoader: PurlGitHubConfigLoader;

	constructor(githubToken?: string) {
		this.localLoader = new LocalConfigLoader();
		this.httpsLoader = new HTTPSConfigLoader();
		this.purlLoader = new PurlGitHubConfigLoader(githubToken);
	}

	async load(source: string): Promise<string> {
		const configSource = detectConfigSource(source);

		let loader: ConfigLoader;
		switch (configSource.type) {
			case "local":
				loader = this.localLoader;
				break;
			case "https":
				loader = this.httpsLoader;
				break;
			case "purl":
				loader = this.purlLoader;
				break;
			default:
				throw new Error(
					`Unsupported config source type: ${configSource.type as string}`,
				);
		}

		return loader.load(configSource.location);
	}
}
