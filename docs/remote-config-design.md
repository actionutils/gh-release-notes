# Remote Config Support Design Document

## Overview
Enable `--config` flag to load configuration files from remote locations in addition to local files. This allows organizations to maintain centralized configuration files (e.g., in `.github` repositories) that can be shared across multiple projects.

## Motivation
- **Centralized Management**: Organizations can maintain a single source of truth for release note generation configurations
- **Consistency**: Ensure consistent release note formatting across all repositories in an organization
- **Competitive Advantage**: Neither GitHub's official release note generation API nor release-drafter currently support remote configs
- **Security Scope**: Limited risk as these are only release note configurations (not build or deployment configs)

## Supported Config Sources

### 1. Local File (existing)
- **Format**: `--config ./path/to/config.yaml`
- **Behavior**: Current implementation, reads from local filesystem

### 2. HTTPS URL
- **Format**: `--config https://example.com/path/to/config.yaml`
- **Behavior**: Fetches config via plain HTTPS GET request (no authentication headers)
- **Validation**: Must be valid HTTPS URL (no HTTP for security)
- **Note**: For GitHub content, prefer purl format over raw.githubusercontent.com URLs (raw URLs have strict rate limits and cannot use token authentication)

### 3. Package URL (purl) - GitHub Type
- **Format**: `--config pkg:github/owner/repo@version?checksum=sha256:abc123...#path/to/config.yaml`
- **Components**:
  - `pkg:github` - purl type identifier
  - `owner/repo` - GitHub repository
  - `@version` - Git ref (branch, tag, or commit SHA) - optional, defaults to default branch
  - `#path/to/config.yaml` - Subpath within the repository (REQUIRED)
  - `?checksum=algorithm:hash` - Optional checksum validation per purl specification
- **Examples**:
  - `pkg:github/myorg/.github#.github/release-notes.yaml` - from default branch
  - `pkg:github/myorg/.github@main#.github/release-notes.yaml` - from main branch
  - `pkg:github/myorg/.github@v1.0.0#configs/release.yaml` - from tag
  - `pkg:github/myorg/.github@v1.0.0#configs/release.yaml?checksum=sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` - with checksum validation
- **API Usage**: GitHub API to fetch raw content
- **Authentication**: Uses existing GitHub token from environment

## Checksum Support for purl (Optional)

### Purpose
Support the purl specification's checksum qualifier for integrity verification of fetched configurations.

### purl Specification Compliance
As per the purl specification, checksums are supported as a qualifier:
- **Parameter Format**: `?checksum=algorithm:hex_value` or comma-separated for multiple: `?checksum=sha1:abc123,sha256:def456`
- **Format**: `lowercase_algorithm:hex_encoded_lowercase_value`
- **Supported Algorithms**:
  - `sha256` (recommended)
  - `sha512`
  - `sha1` (for compatibility)
- **Validation Process**:
  1. Fetch remote content via GitHub API
  2. Calculate checksum(s) of fetched content
  3. Compare with provided checksum(s)
  4. Fail with clear error if any mismatch
- **Example Usage**:
  ```bash
  # Single checksum
  gh-release-notes --config "pkg:github/myorg/.github@v1.0.0#config.yaml?checksum=sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  # Multiple checksums (both must match)
  gh-release-notes --config "pkg:github/myorg/.github@v1.0.0#config.yaml?checksum=sha1:ad9503c3e994a4f611a4892f2e67ac82df727086,sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ```

### Security Benefits
- **Integrity Verification**: Ensures config hasn't been modified unexpectedly
- **Supply Chain Security**: Provides additional layer of protection against config tampering
- **Compliance**: Helps meet security requirements for automated systems
- **Version Pinning**: Combined with specific version tags, provides immutable config references

## Implementation Plan

### Phase 1: Config Loader Interface
```typescript
interface ConfigLoader {
  load(source: string): Promise<Config>;
}

interface ConfigSource {
  type: 'local' | 'https' | 'purl';
  location: string;
  checksum?: {
    algorithm: 'sha256' | 'sha512' | 'sha1';
    hash: string;
  };
}

class LocalConfigLoader implements ConfigLoader { }
class HTTPSConfigLoader implements ConfigLoader { }
class PurlGitHubConfigLoader implements ConfigLoader { }
```

### Phase 2: Source Detection and Parsing
```typescript
function parseConfigSource(source: string): ConfigSource {
  // Parse source string to extract type, location, and optional checksum
  if (source.startsWith('https://')) {
    // Parse HTTPS URL with optional checksum query param
    return { type: 'https', location: url, checksum: extractChecksum(url) };
  }
  if (source.startsWith('pkg:')) {
    // Parse purl with optional checksum qualifier
    return { type: 'purl', location: purl, checksum: extractChecksum(purl) };
  }
  return { type: 'local', location: source };
}
```

### Phase 3: Checksum Validation (purl spec compliant)
```typescript
interface Checksum {
  algorithm: 'sha256' | 'sha512' | 'sha1';
  hash: string;
}

async function validateChecksums(
  content: string,
  checksums: Checksum[]
): Promise<void> {
  for (const checksum of checksums) {
    const calculated = crypto.createHash(checksum.algorithm)
      .update(content)
      .digest('hex');

    if (calculated !== checksum.hash) {
      throw new ChecksumMismatchError(
        `Checksum validation failed for ${checksum.algorithm}. Expected: ${checksum.hash}, Got: ${calculated}`
      );
    }
  }
}

// Parse purl checksum qualifier (comma-separated list)
function parseChecksumQualifier(checksumValue: string): Checksum[] {
  return checksumValue.split(',').map(item => {
    const [algorithm, hash] = item.split(':');
    return { algorithm, hash };
  });
}
```

### Phase 4: GitHub API Integration
- Use existing GitHub client/token infrastructure
- For purl: Parse components and use GitHub Contents API
- Handle rate limiting with appropriate retries and backoff

## Security Considerations

1. **HTTPS Only**: Remote configs must use HTTPS (no HTTP)
2. **Token Scope**: GitHub token only used for purl GitHub type
3. **Limited Impact**: Config only affects release note generation
4. **No Code Execution**: Config is pure data (YAML), no executable code
5. **Validation**: All remote configs go through same validation as local configs
6. **Checksum Verification**: Optional but recommended for production use
7. **Path Traversal Prevention**: Validate and sanitize all file paths
8. **Size Limits**: Enforce reasonable size limits on remote configs (e.g., 1MB max)

## Error Handling

1. **Network Failures**: Clear error messages with retry suggestions
2. **404 Not Found**: Suggest checking path and permissions
3. **Authentication**: Guide users to set up GitHub token if needed
4. **Invalid purl**: Provide clear format requirements and examples
5. **Checksum Mismatch**: Report expected vs actual checksums, suggest verification steps
6. **Rate Limiting**: Inform user of rate limit status and when to retry
7. **Timeout**: Implement reasonable timeouts (30s) with clear error messages

## Usage Examples

```bash
# Local file (existing)
gh-release-notes --config ./release-notes.yaml

# HTTPS URL (for non-GitHub content)
gh-release-notes --config https://example.com/configs/release-notes.yaml

# purl - RECOMMENDED for GitHub content (uses GitHub API with authentication)
gh-release-notes --config pkg:github/myorg/.github#.github/release-notes.yaml

# purl - specific version
gh-release-notes --config pkg:github/myorg/.github@v2.0.0#configs/release.yaml

# purl - with checksum validation (purl spec compliant)
gh-release-notes --config "pkg:github/myorg/.github@v2.0.0?checksum=sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855#configs/release.yaml"

# purl - with multiple checksums (all must match)
gh-release-notes --config "pkg:github/myorg/.github@v1.0.0?checksum=sha1:ad9503c3e994a4f611a4892f2e67ac82df727086,sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855#config.yaml"

# purl - using commit SHA for immutability
gh-release-notes --config pkg:github/myorg/.github@a1b2c3d4#.github/release.yaml

# NOT RECOMMENDED: raw.githubusercontent.com (strict rate limits, no token auth)
# gh-release-notes --config https://raw.githubusercontent.com/myorg/.github/main/release-notes.yaml
```

## Testing Strategy

1. **Unit Tests**
   - Each ConfigLoader implementation (Local, HTTPS, Purl)
   - Checksum calculation and validation
   - Source detection and parsing logic
   - Error handling paths

2. **Integration Tests**
   - Mock HTTP server for HTTPS loader
   - Mock GitHub API responses for purl loader
   - Checksum mismatch scenarios
   - Network timeout and retry behavior

3. **E2E Tests**
   - Real GitHub URLs with authentication (CI only)
   - Various purl formats and versions
   - Config validation after loading

## Future Enhancements

1. **Config Discovery**: Auto-discover configs from parent .github repos
2. **Config Merging**: Support loading and merging multiple config files from different sources
