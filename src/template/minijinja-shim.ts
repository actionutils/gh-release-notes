// Shim for minijinja-js that properly imports and uses WASM
// Import WASM file directly (Bun should embed it when compiling)
import wasmUrl from "../../node_modules/minijinja-js/dist/bundler/minijinja_js_bg.wasm";

// Import the JavaScript bindings from bundler version
import * as minijinjaBg from "minijinja-js/dist/bundler/minijinja_js_bg.js";

// Initialize WASM synchronously
// When compiled with Bun, wasmUrl should be a WebAssembly.Module or ArrayBuffer
// Otherwise, it will be a string path

// Check if wasmUrl is not a string (meaning it's compiled)
const isCompiled = typeof wasmUrl !== 'string';

if (isCompiled) {
  // In compiled binary, wasmUrl could be ArrayBuffer or WebAssembly.Module
  let wasmModule: WebAssembly.Module;

  if (wasmUrl instanceof WebAssembly.Module) {
    wasmModule = wasmUrl;
  } else if (wasmUrl instanceof ArrayBuffer || wasmUrl instanceof Uint8Array) {
    wasmModule = new WebAssembly.Module(wasmUrl);
  } else {
    // Fallback: assume it's some kind of buffer
    wasmModule = new WebAssembly.Module(wasmUrl as any);
  }

  const wasmInstance = new WebAssembly.Instance(wasmModule, {
    "./minijinja_js_bg.js": minijinjaBg
  });
  minijinjaBg.__wbg_set_wasm(wasmInstance.exports);
} else {
  // For normal runtime, we need to load the WASM differently
  // This is a fallback - in practice we'll use --external minijinja-js
  // So this code path won't be reached in compiled binaries

  // Use Node.js fs to read the WASM file synchronously
  const fs = require('fs');
  const path = require('path');
  const wasmPath = path.join(__dirname, '../../node_modules/minijinja-js/dist/bundler/minijinja_js_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = new WebAssembly.Module(wasmBuffer);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {
    "./minijinja_js_bg.js": minijinjaBg
  });
  minijinjaBg.__wbg_set_wasm(wasmInstance.exports);
}

// Export the Environment class from the initialized module
export const { Environment } = minijinjaBg;
