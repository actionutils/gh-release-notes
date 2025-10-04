import * as crypto from "node:crypto";
import type { ConfigSource, Checksum, ParsedPurl } from "./types";

export function detectConfigSource(source: string): ConfigSource {
	if (source.startsWith("https://")) {
		return {
			type: "https",
			location: source,
		};
	}

	if (source.startsWith("pkg:")) {
		const parsed = parsePurl(source);
		const checksums = parsed.qualifiers.checksum
			? parseChecksumQualifier(parsed.qualifiers.checksum)
			: undefined;
		return {
			type: "purl",
			location: source,
			checksum: checksums,
		};
	}

	return {
		type: "local",
		location: source,
	};
}

export function parsePurl(purlString: string): ParsedPurl {
	// Remove the pkg: scheme
	if (!purlString.startsWith("pkg:")) {
		throw new Error("Invalid purl: must start with 'pkg:'");
	}

	const withoutScheme = purlString.slice(4);

	// Split by '#' to get subpath if present (subpath may contain '?')
	const subpathIndex = withoutScheme.indexOf("#");
	let mainPart: string;
	let subpathWithQuery: string | undefined;

	if (subpathIndex !== -1) {
		mainPart = withoutScheme.slice(0, subpathIndex);
		subpathWithQuery = withoutScheme.slice(subpathIndex + 1);
	} else {
		mainPart = withoutScheme;
	}

	if (!mainPart) {
		throw new Error("Invalid purl: empty package specification");
	}

	// Split mainPart by '?' to get qualifiers if present
	const [packagePart, mainQualifierString] = mainPart.split("?");
	if (!packagePart) {
		throw new Error("Invalid purl: empty package specification");
	}

	// Extract qualifiers from both mainPart and subpath
	let qualifierString = mainQualifierString;
	let subpath = subpathWithQuery;

	// If subpath contains '?', split it to get the actual subpath and qualifiers
	if (subpathWithQuery && subpathWithQuery.includes("?")) {
		const [actualSubpath, subpathQualifiers] = subpathWithQuery.split("?");
		subpath = actualSubpath;
		// Merge qualifiers from both sources
		if (qualifierString) {
			qualifierString = `${qualifierString}&${subpathQualifiers}`;
		} else {
			qualifierString = subpathQualifiers;
		}
	}

	// Parse qualifiers
	const qualifiers: Record<string, string> = {};
	if (qualifierString) {
		const pairs = qualifierString.split("&");
		for (const pair of pairs) {
			const [key, value] = pair.split("=");
			if (key && value) {
				qualifiers[decodeURIComponent(key)] = decodeURIComponent(value);
			}
		}
	}

	// Parse package part: type/namespace/name@version or type/name@version
	const [typeAndNamespace, versionPart] = packagePart.split("@");
	if (!typeAndNamespace) {
		throw new Error("Invalid purl: missing type and name");
	}

	const parts = typeAndNamespace.split("/");
	if (parts.length < 2) {
		throw new Error("Invalid purl: missing name");
	}

	const type = parts[0];
	if (!type) {
		throw new Error("Invalid purl: missing type");
	}

	let namespace: string | undefined;
	let name: string;

	if (parts.length === 2) {
		// type/name format
		name = parts[1]!;
	} else {
		// type/namespace/name format (or deeper nesting)
		namespace = parts.slice(1, -1).join("/");
		name = parts[parts.length - 1]!;
	}

	if (!name) {
		throw new Error("Invalid purl: missing name");
	}

	return {
		type: type.toLowerCase(),
		namespace,
		name,
		version: versionPart,
		qualifiers,
		subpath: subpath ? decodeURIComponent(subpath) : undefined,
	};
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
