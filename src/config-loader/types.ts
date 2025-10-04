export interface ConfigLoader {
	load(source: string): Promise<string>;
}

export interface ConfigSource {
	type: "local" | "https" | "purl";
	location: string;
	checksum?: Checksum[];
}

export interface Checksum {
	algorithm: "sha256" | "sha512" | "sha1";
	hash: string;
}

export interface ParsedPurl {
	type: string;
	namespace?: string;
	name: string;
	version?: string;
	qualifiers: Record<string, string>;
	subpath?: string;
}
