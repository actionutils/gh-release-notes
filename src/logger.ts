/**
 * Simple logger utility for conditional verbose output
 */

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
	verboseEnabled = enabled;
}

export function logVerbose(message: string): void {
	if (verboseEnabled) {
		process.stderr.write(`${message}\n`);
	}
}

export function logWarning(message: string): void {
	process.stderr.write(`Warning: ${message}\n`);
}
