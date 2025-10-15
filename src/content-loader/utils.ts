import * as crypto from "node:crypto";
import { PackageURL } from "packageurl-js";
import type { ContentSource, Checksum } from "./types";

export function detectContentSource(source: string): ContentSource {
	if (source.startsWith("https://")) {
		return {
			type: "https",
			location: source,
		};
	}

	if (source.startsWith("pkg:")) {
		return {
			type: "purl",
			location: source,
		};
	}

	return {
		type: "local",
		location: source,
	};
}

export function parsePurl(purlString: string): PackageURL {
	return PackageURL.fromString(purlString);
}

export function parseChecksumQualifier(checksumValue: string): Checksum[] {
	const checksums: Checksum[] = [];
	const items = checksumValue.split(",");

	for (const item of items) {
		const [algorithm, hash] = item.split(":");
		if (!algorithm || !hash) {
			throw new Error(
				`Invalid checksum format: ${item}. Expected algorithm:hash`,
			);
		}

		if (!["sha256", "sha512", "sha1"].includes(algorithm)) {
			throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
		}

		checksums.push({
			algorithm: algorithm as "sha256" | "sha512" | "sha1",
			hash: hash.toLowerCase(),
		});
	}

	return checksums;
}

export async function validateChecksums(
	content: string,
	checksums: Checksum[],
): Promise<void> {
	for (const checksum of checksums) {
		const calculated = crypto
			.createHash(checksum.algorithm)
			.update(content)
			.digest("hex");

		if (calculated !== checksum.hash) {
			throw new Error(
				`Checksum validation failed for ${checksum.algorithm}. Expected: ${checksum.hash}, Got: ${calculated}`,
			);
		}
	}
}
