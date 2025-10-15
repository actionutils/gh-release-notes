// Shim for minijinja-js that works for compiled builds
// Import WASM file directly (Bun embeds it when compiling)
import wasmUrl from "../../node_modules/minijinja-js/dist/bundler/minijinja_js_bg.wasm";

// Import the JavaScript bindings from bundler version
import * as minijinjaBg from "minijinja-js/dist/bundler/minijinja_js_bg.js";

// Initialize WASM
let wasmModule: WebAssembly.Module;

if (typeof wasmUrl !== 'string') {
  // Compiled binary - wasmUrl is embedded
  if (wasmUrl instanceof WebAssembly.Module) {
    wasmModule = wasmUrl;
  } else if (wasmUrl instanceof ArrayBuffer || wasmUrl instanceof Uint8Array) {
    wasmModule = new WebAssembly.Module(wasmUrl);
  } else {
    wasmModule = new WebAssembly.Module(wasmUrl as any);
  }
} else {
  // Normal build - load WASM from file
  const fs = require('fs');
  const path = require('path');
  const wasmPath = path.join(__dirname, '../../node_modules/minijinja-js/dist/bundler/minijinja_js_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  wasmModule = new WebAssembly.Module(wasmBuffer);
}

const wasmInstance = new WebAssembly.Instance(wasmModule, {
  "./minijinja_js_bg.js": minijinjaBg
});

minijinjaBg.__wbg_set_wasm(wasmInstance.exports);

export const { Environment } = minijinjaBg;
