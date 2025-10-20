# Manual Release Notes

This feature allows you to embed custom, manually-written content into automatically generated release notes using MiniJinja's include functionality.

## Directory Structure

```
.changelog/
├── templates/           # Global templates - available for ALL releases
│   ├── header.md
│   ├── footer.md.jinja
│   └── common-notice.md
├── from-v1.0.0/        # Templates for the NEXT release after v1.0.0
│   └── migration-note.md
└── v2.0.0/             # Tag-specific templates - only for v2.0.0
    ├── header.md       # Overrides templates/header.md for v2.0.0
    └── special-announcement.md
```

## Template Types

### 1. Global Templates (`.changelog/templates/`)
- **Purpose**: Content that appears in ALL releases
- **Use cases**: Common headers, standard footers, support links, contribution guidelines
- **Priority**: Lowest (can be overridden by more specific templates)

### 2. From-Tag Templates (`.changelog/from-{tag}/`)
- **Purpose**: Content for the NEXT release after the specified tag
- **Use cases**: Migration notes, breaking change announcements, deprecation warnings
- **Example**: `.changelog/from-v1.0.0/` contains content that will appear in v1.1.0, v2.0.0, etc.
- **Priority**: Medium (overrides global templates, overridden by tag-specific)

### 3. Tag-Specific Templates (`.changelog/{tag}/`)
- **Purpose**: Content exclusively for that specific release
- **Use cases**: Special announcements, version-specific notes, one-time messages
- **Priority**: Highest (overrides all other templates)

## File Types

### Static Markdown (`.md`)
Regular markdown files included as-is:

```markdown
## 🎉 Major Release

This is a significant update with many new features!
```

### Template Files (`.md.jinja`)
Markdown files with MiniJinja template syntax that have access to all template variables:

```jinja
## 🙏 Special Thanks

Special thanks to all {{ contributors | length }} contributors who made this release possible!

{% if newContributors | length > 0 %}
We especially welcome our {{ newContributors | length }} new contributors!
{% endif %}
```

## Priority System

When multiple templates with the same filename exist, they are loaded in this priority order (highest priority wins):

1. **Tag-specific** (`.changelog/{tag}/footer.md`)
2. **From-tag** (`.changelog/from-{prevTag}/footer.md`)
3. **Global** (`.changelog/templates/footer.md`)

## Template Usage in Built-in Templates

All built-in templates include these optional sections:

```jinja
{#- Include optional header content -#}
{% include ['header.md.jinja', 'header.md'] ignore missing %}

## What's Changed
...automatically generated content...

{#- Include optional body content -#}
{% include ['body.md.jinja', 'body.md'] ignore missing %}

...more automatically generated content...

{#- Include optional footer content -#}
{% include ['footer.md.jinja', 'footer.md'] ignore missing %}
```

You can include ANY filename, not just `header`, `body`, and `footer`. For example:

```jinja
{% include ['migration-guide.md.jinja', 'migration-guide.md'] ignore missing %}
{% include ['breaking-changes.md'] ignore missing %}
{% include ['special-announcement.md.jinja'] ignore missing %}
```

## Available Template Variables

When using `.md.jinja` files, you have access to all template variables:

- `tag` - Current release tag
- `release` - Release information object
- `lastRelease` - Previous release information
- `contributors` - Array of all contributors
- `newContributors` - Array of first-time contributors
- `pullRequests` - Map of PR number to PR data
- `categorizedPullRequests` - Categorized PR data
- `fullChangelogLink` - Link to the full changelog
- And many more...

## Real-World Examples

### Global Footer (`.changelog/templates/footer.md.jinja`)
```jinja
---

## 📚 Resources

- [Documentation](https://docs.example.com)
- [Support Forum](https://community.example.com)
- [Report Issues](https://github.com/user/repo/issues)

Built with ❤️ by {{ contributors | length }} contributors
```

### Migration Note for Next Release (`.changelog/from-v1.9.0/migration-guide.md`)
```markdown
## ⚠️ Migration Required

Starting with this release, please update your configuration files.
See our [migration guide](https://docs.example.com/migrate-v2) for details.
```

### Special v2.0.0 Announcement (`.changelog/v2.0.0/header.md`)
```markdown
🎊 **Major Version 2.0 is Here!** 🎊

After months of development, we're excited to release version 2.0 with a completely redesigned architecture.
```

## Best Practices

1. **Use sparingly**: This feature is for content that can't be captured from PRs alone
2. **Static vs Template**: Use `.md` for static content, `.md.jinja` when you need variables
3. **Consistent naming**: Use descriptive filenames like `migration-guide.md`, `breaking-changes.md`
4. **Test locally**: Always test your templates before releasing
5. **Version control**: Commit these files so they're available during release generation

## File Discovery

The system automatically discovers and loads ALL `.md` and `.md.jinja` files from the relevant directories. No need to pre-define filenames - just create the files you need!
