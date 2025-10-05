/**
 * Simple logger utility for conditional verbose output
 */

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
	verboseEnabled = enabled;
}

export function logVerbose(message: string): void {
	if (verboseEnabled) {
		const prefix = `[${new Date().toISOString()}] `;
		process.stderr.write(`${prefix}${message}\n`);
	}
}

export function logWarning(message: string): void {
	process.stderr.write(`Warning: ${message}\n`);
}
