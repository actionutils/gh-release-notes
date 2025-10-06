/**
 * Shared constants used across the application
 */

/**
 * GitHub-style change template that matches GitHub's official release notes format
 */
export const GITHUB_STYLE_CHANGE_TEMPLATE = "- $TITLE by @$AUTHOR in $URL";

/**
 * GitHub-style category template that matches GitHub's official release notes format
 */
export const GITHUB_STYLE_CATEGORY_TEMPLATE = "### $TITLE";

/**
 * Default template for release notes body
 */
export const DEFAULT_RELEASE_TEMPLATE = `## What's Changed

$CHANGES

$NEW_CONTRIBUTORS

**Full Changelog**: $FULL_CHANGELOG_LINK`;

/**
 * Default fallback config for release-drafter when no config is provided
 */
export const DEFAULT_FALLBACK_CONFIG = {
	template: DEFAULT_RELEASE_TEMPLATE,
	"change-template": GITHUB_STYLE_CHANGE_TEMPLATE,
	"category-template": GITHUB_STYLE_CATEGORY_TEMPLATE,
	"sort-direction": "ascending", // Aligned with GitHub Generate Release Note API
};
