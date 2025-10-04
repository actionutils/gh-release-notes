import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ConfigLoader } from "./types";

export class LocalConfigLoader implements ConfigLoader {
	async load(source: string): Promise<string> {
		const resolvedPath = path.resolve(process.cwd(), source);
		try {
			const content = await fs.readFile(resolvedPath, "utf-8");
			return content;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Config file not found: ${resolvedPath}`);
			}
			throw new Error(
				`Failed to read config file: ${(error as Error).message}`,
			);
		}
	}
}
