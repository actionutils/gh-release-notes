import { describe, it, expect } from "bun:test";
import {
	detectContentSource,
	parsePurl,
	parseChecksumQualifier,
	validateChecksums,
} from "./utils";

describe("detectContentSource", () => {
	it("detects local files", () => {
		expect(detectContentSource("./content.yaml")).toEqual({
			type: "local",
			location: "./content.yaml",
		});

		expect(detectContentSource("/absolute/path/content.json")).toEqual({
			type: "local",
			location: "/absolute/path/content.json",
		});

		expect(detectContentSource("relative/path.yml")).toEqual({
			type: "local",
			location: "relative/path.yml",
		});
	});

	it("detects HTTPS URLs", () => {
		expect(detectContentSource("https://example.com/content.yaml")).toEqual({
			type: "https",
			location: "https://example.com/content.yaml",
		});

		expect(
			detectContentSource(
				"https://raw.githubusercontent.com/org/repo/main/content.yaml",
			),
		).toEqual({
			type: "https",
			location: "https://raw.githubusercontent.com/org/repo/main/content.yaml",
		});
	});

	it("detects purl sources", () => {
		const result = detectContentSource(
			"pkg:github/owner/repo#path/content.yaml",
		);
		expect(result.type).toBe("purl");
		expect(result.location).toBe("pkg:github/owner/repo#path/content.yaml");
	});

	it("detects purl with checksum", () => {
		const result = detectContentSource(
			"pkg:github/owner/repo?checksum=sha256:abc123#path/content.yaml",
		);
		expect(result.type).toBe("purl");
		expect(result.location).toBe(
			"pkg:github/owner/repo?checksum=sha256:abc123#path/content.yaml",
		);
	});
});

describe("parsePurl", () => {
	it("parses basic GitHub purl", () => {
		const result = parsePurl("pkg:github/owner/repo#path/to/file.yaml");
		expect(result.type).toBe("github");
		expect(result.namespace).toBe("owner");
		expect(result.name).toBe("repo");
		expect(result.version).toBeUndefined();
		expect(result.qualifiers).toBeUndefined();
		expect(result.subpath).toBe("path/to/file.yaml");
	});

	it("parses GitHub purl with version", () => {
		const result = parsePurl("pkg:github/owner/repo@v1.0.0#content.yaml");
		expect(result.type).toBe("github");
		expect(result.namespace).toBe("owner");
		expect(result.name).toBe("repo");
		expect(result.version).toBe("v1.0.0");
		expect(result.qualifiers).toBeUndefined();
		expect(result.subpath).toBe("content.yaml");
	});

	it("parses GitHub purl with qualifiers", () => {
		const result = parsePurl(
			"pkg:github/owner/repo@main?checksum=sha256:abc123&foo=bar#.github/content.yaml",
		);
		expect(result.type).toBe("github");
		expect(result.namespace).toBe("owner");
		expect(result.name).toBe("repo");
		expect(result.version).toBe("main");
		expect(result.qualifiers).toEqual({
			checksum: "sha256:abc123",
			foo: "bar",
		});
		expect(result.subpath).toBe(".github/content.yaml");
	});

	it("parses GitHub purl with nested namespace", () => {
		const result = parsePurl("pkg:github/org/team/repo#file.yaml");
		expect(result.type).toBe("github");
		expect(result.namespace).toBe("org/team");
		expect(result.name).toBe("repo");
		expect(result.version).toBeUndefined();
		expect(result.qualifiers).toBeUndefined();
		expect(result.subpath).toBe("file.yaml");
	});

	it("parses GitHub purl without namespace", () => {
		const result = parsePurl("pkg:github/singlename#file.yaml");
		expect(result.type).toBe("github");
		expect(result.namespace).toBeUndefined();
		expect(result.name).toBe("singlename");
		expect(result.version).toBeUndefined();
		expect(result.qualifiers).toBeUndefined();
		expect(result.subpath).toBe("file.yaml");
	});

	it("handles URL-encoded values", () => {
		const result = parsePurl(
			"pkg:github/owner/repo?key=value%20with%20spaces#path%20with%20spaces/file.yaml",
		);
		expect(result.subpath).toBe("path with spaces/file.yaml");
		expect(result.qualifiers?.key).toBe("value with spaces");
	});

	it("throws on invalid purl format", () => {
		expect(() => parsePurl("not-a-purl")).toThrow("Invalid purl");
		expect(() => parsePurl("pkg:")).toThrow("Invalid purl");
		expect(() => parsePurl("pkg:github")).toThrow("Invalid purl");
		expect(() => parsePurl("pkg:/name")).toThrow("Invalid purl");
	});
});

describe("parseChecksumQualifier", () => {
	it("parses single checksum", () => {
		const result = parseChecksumQualifier("sha256:abc123def456");
		expect(result).toEqual([{ algorithm: "sha256", hash: "abc123def456" }]);
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

		expect(await validateChecksums(content, [checksum])).toBeUndefined();
	});

	it("validates correct sha1 checksum", async () => {
		// Pre-calculated sha1 hash of "Hello, World!"
		const checksum = {
			algorithm: "sha1" as const,
			hash: "0a0a9f2a6772942557ab5355d76af442f8f65e01",
		};

		expect(await validateChecksums(content, [checksum])).toBeUndefined();
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

		expect(await validateChecksums(content, checksums)).toBeUndefined();
	});

	it("throws on incorrect checksum", async () => {
		const checksum = {
			algorithm: "sha256" as const,
			hash: "incorrect_hash",
		};

		expect(async () => {
			await validateChecksums(content, [checksum]);
		}).toThrow("Checksum validation failed for sha256");
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

		expect(async () => {
			await validateChecksums(content, checksums);
		}).toThrow("Checksum validation failed for sha256");
	});
});
