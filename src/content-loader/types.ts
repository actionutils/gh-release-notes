export interface ContentLoader {
	load(source: string): Promise<string>;
}

export interface ContentSource {
	type: "local" | "https" | "purl";
	location: string;
}

export interface Checksum {
	algorithm: "sha256" | "sha512" | "sha1";
	hash: string;
}
