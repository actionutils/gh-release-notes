# Compiling to Standalone Binary

## Using bun compile

You can create a standalone executable using:

```bash
bun run compile
```

This will create a `gh-release-notes` binary in the root directory.

### Important Note

Due to WebAssembly module limitations in `minijinja-js`, the compiled binary still requires `minijinja-js` to be installed in `node_modules` when using template features (`--template` option).

The binary will work without `node_modules` for all other features (JSON output, default release notes generation, etc.), but template rendering specifically requires the WASM module from `minijinja-js`.

### Workaround

If you need a fully standalone binary with template support, you have two options:

1. **Ship with node_modules**: Include the `node_modules/minijinja-js` directory alongside your binary
2. **Use without templates**: The binary works fully standalone when not using the `--template` option

### Technical Details

The issue stems from how Bun handles WebAssembly modules during compilation. The `minijinja-js` library uses WASM for its template engine, and Bun's current compilation process doesn't fully embed WASM modules in a way that's compatible with the library's initialization code.

We use the `--external minijinja-js` flag during compilation to avoid bundling errors, which means the module needs to be available at runtime.
