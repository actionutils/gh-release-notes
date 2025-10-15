// Unified shim that works for both normal and compiled builds
import wasmData from "minijinja-js/dist/bundler/minijinja_js_bg.wasm";
import * as minijinjaBg from "minijinja-js/dist/bundler/minijinja_js_bg.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// File path - resolve and read it
// If it's an absolute path (compiled mode), use it directly
// If it's a relative path (normal build), resolve it relative to the current module
let wasmPath = wasmData;
if (!wasmData.startsWith("/") && !wasmData.startsWith("\\")) {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	wasmPath = join(currentDir, wasmData);
}
const wasmBytes = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);

const wasmInstance = new WebAssembly.Instance(wasmModule, {
	"./minijinja_js_bg.js": minijinjaBg,
});
minijinjaBg.__wbg_set_wasm(wasmInstance.exports);

// Re-export Environment from the main module
export { Environment } from "minijinja-js/dist/bundler/minijinja_js.js";
