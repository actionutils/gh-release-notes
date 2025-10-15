import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ContentLoader } from "./types";
import { logVerbose } from "../logger";

export class LocalContentLoader implements ContentLoader {
	async load(source: string): Promise<string> {
		const resolvedPath = path.resolve(process.cwd(), source);
		logVerbose(`[ContentLoader:local] Reading file: ${resolvedPath}`);
		try {
			const content = await fs.readFile(resolvedPath, "utf-8");
			logVerbose(
				`[ContentLoader:local] Read ${content.length} bytes from ${resolvedPath}`,
			);
			return content;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Content file not found: ${resolvedPath}`);
			}
			throw new Error(
				`Failed to read content file: ${(error as Error).message}`,
			);
		}
	}
}
