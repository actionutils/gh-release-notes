// Use MiniJinja's supported Node entry point in the npm library. Its static
// WASM file reference is understood by consumers' bundlers, including ncc.
// The standalone CLI keeps the existing shim for Bun's embedded assets.
const result = await Bun.build({
	entrypoints: ["src/index.ts"],
	outdir: "dist",
	target: "node",
	external: ["minijinja-js"],
	plugins: [
		{
			name: "node-template-engine",
			setup(build) {
				build.onLoad({ filter: /minijinja-shim\.ts$/ }, () => ({
					contents: 'export { Environment } from "minijinja-js";',
					loader: "js",
				}));
			},
		},
	],
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exitCode = 1;
}
