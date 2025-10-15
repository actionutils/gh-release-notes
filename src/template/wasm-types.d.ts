// Type declarations for WASM bundler modules
declare module "minijinja-js/dist/bundler/minijinja_js_bg.wasm" {
	const wasmData: string;
	export default wasmData;
}

declare module "minijinja-js/dist/bundler/minijinja_js_bg.js" {
	export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
