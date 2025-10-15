import type { ContentLoader } from "./types";
import { logVerbose } from "../logger";

export class HTTPSContentLoader implements ContentLoader {
	private timeout: number;

	constructor(timeout = 30000) {
		this.timeout = timeout;
	}

	async load(source: string): Promise<string> {
		if (!source.startsWith("https://")) {
			throw new Error("URL must use HTTPS protocol");
		}

		logVerbose(`[ContentLoader:https] Fetching: ${source}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(source, {
				signal: controller.signal,
				headers: {
					"User-Agent": "gh-release-notes",
				},
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(
					`Failed to fetch content: HTTP ${response.status} ${response.statusText}`,
				);
			}

			const text = await response.text();
			logVerbose(
				`[ContentLoader:https] Fetched ${text.length} bytes from ${source}`,
			);

			// Check for reasonable size limit (1MB)
			if (text.length > 1024 * 1024) {
				throw new Error("Content file too large (max 1MB)");
			}

			return text;
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`Request timeout after ${this.timeout}ms`);
			}

			throw new Error(
				`Failed to fetch content from ${source}: ${(error as Error).message}`,
			);
		}
	}
}
