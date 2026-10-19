### 🎯 Key Features in This Release

#### 🔗 Issue-Linked Pull Requests Support
The game-changing feature from issue #114 allows tracking complete feature stories across multiple PRs:

- [#114](https://github.com/actionutils/gh-release-notes/issues/114): Support getting All Issues Linked to Pull Requests in [#129](https://github.com/actionutils/gh-release-notes/pull/129), [#131](https://github.com/actionutils/gh-release-notes/pull/131), [#133](https://github.com/actionutils/gh-release-notes/pull/133) by @haya14busa ($\textsf{\color{ #3fb950}{\textsf{+1023}}\color{ #f85149}{\textsf{ -16}}}$)

**What this enables:**
- **Smart Grouping**: When an issue is linked to multiple PRs, show the complete feature story
- **Reduced Duplication**: Issues take priority over individual PRs to avoid clutter
- **Unified View**: See the full scope of work including linked PRs and combined statistics
- **Template Examples**: New `github-ext-with-issues.md.jinja` and `label-with-issues.md.jinja` templates demonstrate this feature

#### 📝 Manual Release Notes Support
With PR #118, you can now create rich, customized release notes by placing markdown files in `.changelog/` directories:
- Global templates in `.changelog/templates/`
- Version-specific content in `.changelog/from-v0.7.0/`
- Include them with `{% raw %}{% include ['header.md'] ignore missing %}{% endraw %}`

#### 📊 Enhanced JSON Output
- **PR Statistics**: Now includes `additions` and `deletions` for each pull request (#111)
- **Timing Data**: Added `latestMergedAt` timestamp for better time tracking (#113)

This release includes **{{ mergedPullRequests | length }} merged pull requests**.
