// Unified shim that works for both normal and compiled builds
// This avoids code duplication by handling both cases in one file

// Export the Environment based on the runtime context
export let Environment: any;

// Initialize Environment based on build type
(function initializeEnvironment() {
  try {
    // Try normal minijinja-js first (for regular builds)
    const minijinja = require('minijinja-js');
    Environment = minijinja.Environment;
  } catch (e) {
    // If that fails, we're in a compiled build
    // Use dynamic imports to avoid build errors in normal mode
    try {
      // These requires will be transformed by Bun during compilation
      const wasmData = require("../../node_modules/minijinja-js/dist/bundler/minijinja_js_bg.wasm");
      const minijinjaBg = require("minijinja-js/dist/bundler/minijinja_js_bg.js");

      // Initialize WASM
      let wasmModule: WebAssembly.Module;

      if (wasmData instanceof WebAssembly.Module) {
        wasmModule = wasmData;
      } else if (wasmData instanceof ArrayBuffer || wasmData instanceof Uint8Array) {
        wasmModule = new WebAssembly.Module(wasmData);
      } else {
        throw new Error("Unexpected WASM data format");
      }

      const wasmInstance = new WebAssembly.Instance(wasmModule, {
        "./minijinja_js_bg.js": minijinjaBg
      });

      minijinjaBg.__wbg_set_wasm(wasmInstance.exports);
      Environment = minijinjaBg.Environment;
    } catch (shimError) {
      throw new Error(`Failed to initialize minijinja: ${shimError}`);
    }
  }
})();
