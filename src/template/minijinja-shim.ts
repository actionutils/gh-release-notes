// Unified shim that works for both normal and compiled builds
import wasmData from "minijinja-js/dist/bundler/minijinja_js_bg.wasm"
import * as minijinjaBg from "minijinja-js/dist/bundler/minijinja_js_bg.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
// If it's an absolute path (compiled mode), use it directly
// If it's a relative path (normal build), resolve it relative to the current module
let wasmPath = wasmData;
if (!wasmData.startsWith('/') && !wasmData.startsWith('\\')) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  wasmPath = join(currentDir, wasmData);
}
const wasmModule = new WebAssembly.Module(readFileSync(wasmPath));
const wasmInstance = new WebAssembly.Instance(wasmModule, {
  "./minijinja_js_bg.js": minijinjaBg
});
minijinjaBg.__wbg_set_wasm(wasmInstance.exports);
export const Environment = minijinjaBg.Environment;
