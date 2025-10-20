# Manual Release Notes

This feature allows you to embed custom, manually-written content into automatically generated release notes using MiniJinja's include functionality.

## Directory Structure

```
.changelog/
├── templates/           # Global templates - available for ALL releases
│   ├── header.md
│   ├── footer.html.jinja
│   └── common-notice.txt
├── from-v1.0.0/        # Templates for the NEXT release after v1.0.0
│   └── migration-note.md
└── v2.0.0/             # Tag-specific templates - only for v2.0.0
    ├── header.md       # Overrides templates/header.md for v2.0.0
    └── special-announcement.html
```

## Template Types

### 1. Global Templates (`.changelog/templates/`)
- **Purpose**: Content that appears in ALL releases
- **Use cases**: Common headers, standard footers, support links, contribution guidelines
- **Priority**: Lowest (can be overridden by more specific templates)

### 2. From-Tag Templates (`.changelog/from-{tag}/`)
- **Purpose**: Content for the NEXT release after the specified tag
- **Use cases**: Migration notes, breaking change announcements, deprecation warnings
- **Example**: `.changelog/from-v1.0.0/` contains content that will appear in v1.1.0 (minor version up), v2.0.0 (major version up), etc.
- **Priority**: Medium (overrides global templates, overridden by tag-specific)

### 3. Tag-Specific Templates (`.changelog/{tag}/`)
- **Purpose**: Content exclusively for that specific release
- **Use cases**: Special announcements, version-specific notes, one-time messages
- **Priority**: Highest (overrides all other templates)

## File Types

Any file extension is supported (`.md`, `.html`, `.txt`, `.jinja`, etc.). All files are processed as MiniJinja templates and have access to template variables.

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
{% include ['special-announcement.html.jinja'] ignore missing %}
```

## Template Variables

All template files have access to the same template variables as the main release templates.

## Best Practices

1. **Use sparingly**: This feature is for content that can't be captured from PRs alone
2. **Descriptive naming**: Use filenames like `migration-guide.md`, `breaking-changes.md` that reflect the content purpose
3. **Test locally**: Always test your templates before releasing
4. **Version control**: Commit these files so they're available during release generation

## File Discovery

The system automatically discovers and loads ALL files from the relevant directories (except hidden files starting with `.`). No need to pre-define filenames - just create the files you need!
