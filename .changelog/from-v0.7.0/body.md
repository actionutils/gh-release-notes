### 🎯 Key Features in This Release

#### 📚 Reusable Library
The npm package now has a working public entry point and TypeScript types.
`configRef` loads repository configuration without a checkout, and the Node
library supports bundlers such as ncc, including MiniJinja's WASM asset.

#### 📝 Manual Release Notes Support
With PR #118, you can now create rich, customized release notes by placing markdown files in `.changelog/` directories:
- Global templates in `.changelog/templates/`
- Version-specific content in `.changelog/from-v0.7.0/`
- Include them with `{% raw %}{% include ['header.md'] ignore missing %}{% endraw %}`

#### 📊 Enhanced JSON Output
- **PR Statistics**: Now includes `additions` and `deletions` for each pull request (#111)
- **Timing Data**: Added `latestMergedAt` timestamp for better time tracking (#113)

This release includes **{{ mergedPullRequests | length }} merged pull requests**.
