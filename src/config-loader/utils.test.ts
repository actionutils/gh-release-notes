import { describe, it, expect } from "@jest/globals";
import {
	detectConfigSource,
	parsePurl,
	parseChecksumQualifier,
	validateChecksums,
} from "./utils";

describe("detectConfigSource", () => {
	it("detects local files", () => {
		expect(detectConfigSource("./config.yaml")).toEqual({
			type: "local",
			location: "./config.yaml",
		});

		expect(detectConfigSource("/absolute/path/config.json")).toEqual({
			type: "local",
			location: "/absolute/path/config.json",
		});

		expect(detectConfigSource("relative/path.yml")).toEqual({
			type: "local",
			location: "relative/path.yml",
		});
	});

	it("detects HTTPS URLs", () => {
		expect(detectConfigSource("https://example.com/config.yaml")).toEqual({
			type: "https",
			location: "https://example.com/config.yaml",
		});

		expect(
			detectConfigSource("https://raw.githubusercontent.com/org/repo/main/config.yaml"),
		).toEqual({
			type: "https",
			location: "https://raw.githubusercontent.com/org/repo/main/config.yaml",
		});
	});

	it("detects purl sources", () => {
		const result = detectConfigSource("pkg:github/owner/repo#path/config.yaml");
		expect(result.type).toBe("purl");
		expect(result.location).toBe("pkg:github/owner/repo#path/config.yaml");
		expect(result.checksum).toBeUndefined();
	});

	it("detects purl with checksum", () => {
		const result = detectConfigSource(
			"pkg:github/owner/repo#path/config.yaml?checksum=sha256:abc123",
		);
		expect(result.type).toBe("purl");
		expect(result.checksum).toEqual([
			{ algorithm: "sha256", hash: "abc123" },
		]);
	});
});

describe("parsePurl", () => {
	it("parses basic GitHub purl", () => {
		const result = parsePurl("pkg:github/owner/repo#path/to/file.yaml");
		expect(result).toEqual({
			type: "github",
			namespace: "owner",
			name: "repo",
			version: undefined,
			qualifiers: {},
			subpath: "path/to/file.yaml",
		});
	});

	it("parses GitHub purl with version", () => {
		const result = parsePurl("pkg:github/owner/repo@v1.0.0#config.yaml");
		expect(result).toEqual({
			type: "github",
			namespace: "owner",
			name: "repo",
			version: "v1.0.0",
			qualifiers: {},
			subpath: "config.yaml",
		});
	});

	it("parses GitHub purl with qualifiers", () => {
		const result = parsePurl(
			"pkg:github/owner/repo@main#.github/config.yaml?checksum=sha256:abc123&foo=bar",
		);
		expect(result).toEqual({
			type: "github",
			namespace: "owner",
			name: "repo",
			version: "main",
			qualifiers: {
				checksum: "sha256:abc123",
				foo: "bar",
			},
			subpath: ".github/config.yaml",
		});
	});

	it("parses GitHub purl with nested namespace", () => {
		const result = parsePurl("pkg:github/org/team/repo#file.yaml");
		expect(result).toEqual({
			type: "github",
			namespace: "org/team",
			name: "repo",
			version: undefined,
			qualifiers: {},
			subpath: "file.yaml",
		});
	});

	it("parses GitHub purl without namespace", () => {
		const result = parsePurl("pkg:github/singlename#file.yaml");
		expect(result).toEqual({
			type: "github",
			namespace: undefined,
			name: "singlename",
			version: undefined,
			qualifiers: {},
			subpath: "file.yaml",
		});
	});

	it("handles URL-encoded values", () => {
		const result = parsePurl(
			"pkg:github/owner/repo#path%20with%20spaces/file.yaml?key=value%20with%20spaces",
		);
		expect(result.subpath).toBe("path with spaces/file.yaml");
		expect(result.qualifiers.key).toBe("value with spaces");
	});

	it("throws on invalid purl format", () => {
		expect(() => parsePurl("not-a-purl")).toThrow("Invalid purl: must start with 'pkg:'");
		expect(() => parsePurl("pkg:")).toThrow("Invalid purl: empty package specification");
		expect(() => parsePurl("pkg:github")).toThrow("Invalid purl: missing name");
		expect(() => parsePurl("pkg:/name")).toThrow("Invalid purl: missing type");
	});
});

describe("parseChecksumQualifier", () => {
	it("parses single checksum", () => {
		const result = parseChecksumQualifier("sha256:abc123def456");
		expect(result).toEqual([
			{ algorithm: "sha256", hash: "abc123def456" },
		]);
	});

	it("parses multiple checksums", () => {
		const result = parseChecksumQualifier(
			"sha1:abc123,sha256:def456,sha512:789abc",
		);
		expect(result).toEqual([
			{ algorithm: "sha1", hash: "abc123" },
			{ algorithm: "sha256", hash: "def456" },
			{ algorithm: "sha512", hash: "789abc" },
		]);
	});

	it("converts hash to lowercase", () => {
		const result = parseChecksumQualifier("sha256:ABC123DEF");
		expect(result[0].hash).toBe("abc123def");
	});

	it("throws on invalid format", () => {
		expect(() => parseChecksumQualifier("invalid")).toThrow(
			"Invalid checksum format: invalid",
		);
		expect(() => parseChecksumQualifier("sha256")).toThrow(
			"Invalid checksum format: sha256",
		);
		expect(() => parseChecksumQualifier(":hash")).toThrow(
			"Invalid checksum format: :hash",
		);
	});

	it("throws on unsupported algorithm", () => {
		expect(() => parseChecksumQualifier("md5:abc123")).toThrow(
			"Unsupported checksum algorithm: md5",
		);
	});
});

describe("validateChecksums", () => {
	const content = "Hello, World!";

	it("validates correct sha256 checksum", async () => {
		// Pre-calculated sha256 hash of "Hello, World!"
		const checksum = {
			algorithm: "sha256" as const,
			hash: "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
		};

		await expect(validateChecksums(content, [checksum])).resolves.toBeUndefined();
	});

	it("validates correct sha1 checksum", async () => {
		// Pre-calculated sha1 hash of "Hello, World!"
		const checksum = {
			algorithm: "sha1" as const,
			hash: "0a0a9f2a6772942557ab5355d76af442f8f65e01",
		};

		await expect(validateChecksums(content, [checksum])).resolves.toBeUndefined();
	});

	it("validates multiple checksums", async () => {
		const checksums = [
			{
				algorithm: "sha256" as const,
				hash: "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
			},
			{
				algorithm: "sha1" as const,
				hash: "0a0a9f2a6772942557ab5355d76af442f8f65e01",
			},
		];

		await expect(validateChecksums(content, checksums)).resolves.toBeUndefined();
	});

	it("throws on incorrect checksum", async () => {
		const checksum = {
			algorithm: "sha256" as const,
			hash: "incorrect_hash",
		};

		await expect(validateChecksums(content, [checksum])).rejects.toThrow(
			"Checksum validation failed for sha256",
		);
	});

	it("throws on first incorrect checksum in list", async () => {
		const checksums = [
			{
				algorithm: "sha256" as const,
				hash: "incorrect",
			},
			{
				algorithm: "sha1" as const,
				hash: "0a0a9f2a6772942557ab5355d76af442f8f65e01",
			},
		];

		await expect(validateChecksums(content, checksums)).rejects.toThrow(
			"Checksum validation failed for sha256",
		);
	});
});
