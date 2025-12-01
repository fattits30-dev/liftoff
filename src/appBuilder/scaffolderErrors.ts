/**
 * Custom error classes for Scaffolder operations
 */

/**
 * Base error class for all scaffolder errors
 */
export class ScaffolderError extends Error {
    constructor(
        message: string,
        public readonly tier?: 1 | 2 | 3,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'ScaffolderError';
        Object.setPrototypeOf(this, ScaffolderError.prototype);
    }
}

/**
 * TIER 1: CLI Bootstrap errors
 * Thrown when official CLI commands fail (npm create vite, etc.)
 */
export class Tier1BootstrapError extends ScaffolderError {
    constructor(
        message: string,
        public readonly command: string,
        public readonly exitCode?: number,
        public readonly stderr?: string
    ) {
        super(message, 1, { command, exitCode, stderr });
        this.name = 'Tier1BootstrapError';
        Object.setPrototypeOf(this, Tier1BootstrapError.prototype);
    }
}

/**
 * TIER 2: Template Overlay errors
 * Thrown when inline template operations fail
 */
export class Tier2OverlayError extends ScaffolderError {
    constructor(
        message: string,
        public readonly filePath?: string,
        public readonly operation?: 'create' | 'write' | 'mkdir'
    ) {
        super(message, 2, { filePath, operation });
        this.name = 'Tier2OverlayError';
        Object.setPrototypeOf(this, Tier2OverlayError.prototype);
    }
}

/**
 * TIER 3: AI Generation errors
 * Thrown when AI code generation fails
 */
export class Tier3GenerationError extends ScaffolderError {
    constructor(
        message: string,
        public readonly feature?: string,
        public readonly tokenCount?: number
    ) {
        super(message, 3, { feature, tokenCount });
        this.name = 'Tier3GenerationError';
        Object.setPrototypeOf(this, Tier3GenerationError.prototype);
    }
}

/**
 * Validation errors
 * Thrown when bootstrap validation or path validation fails
 */
export class ValidationError extends ScaffolderError {
    constructor(
        message: string,
        public readonly validationType: 'bootstrap' | 'path' | 'dependency' | 'file',
        public readonly expected?: string,
        public readonly actual?: string
    ) {
        super(message, undefined, { validationType, expected, actual });
        this.name = 'ValidationError';
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}

/**
 * Command timeout errors
 * Thrown when commands exceed their time limit
 */
export class TimeoutError extends ScaffolderError {
    constructor(
        message: string,
        public readonly command: string,
        public readonly timeoutMs: number
    ) {
        super(message, undefined, { command, timeoutMs });
        this.name = 'TimeoutError';
        Object.setPrototypeOf(this, TimeoutError.prototype);
    }
}

/**
 * Rollback errors
 * Thrown when cleanup/rollback operations fail
 */
export class RollbackError extends ScaffolderError {
    constructor(
        message: string,
        public readonly originalError: Error,
        public readonly rollbackOperation: string
    ) {
        super(message, undefined, { originalError: originalError.message, rollbackOperation });
        this.name = 'RollbackError';
        Object.setPrototypeOf(this, RollbackError.prototype);
    }
}

/**
 * Helper to determine if error is recoverable
 */
export function isRecoverableError(error: Error): boolean {
    // Network errors, rate limits, temporary failures are recoverable
    if (error instanceof TimeoutError) return true;
    if (error instanceof Tier3GenerationError) return true; // AI can retry

    // File system and validation errors are not recoverable
    if (error instanceof ValidationError) return false;
    if (error instanceof Tier1BootstrapError) return false;

    return false;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: Error): string {
    if (error instanceof Tier1BootstrapError) {
        return `[TIER 1 Bootstrap Failed] ${error.message}\nCommand: ${error.command}\n${error.stderr || ''}`;
    }

    if (error instanceof Tier2OverlayError) {
        return `[TIER 2 Overlay Failed] ${error.message}\nFile: ${error.filePath || 'unknown'}`;
    }

    if (error instanceof Tier3GenerationError) {
        return `[TIER 3 AI Generation Failed] ${error.message}\nFeature: ${error.feature || 'unknown'}`;
    }

    if (error instanceof ValidationError) {
        return `[Validation Failed] ${error.message}\nType: ${error.validationType}`;
    }

    if (error instanceof TimeoutError) {
        return `[Timeout] ${error.message}\nCommand: ${error.command}\nLimit: ${error.timeoutMs}ms`;
    }

    if (error instanceof RollbackError) {
        return `[Rollback Failed] ${error.message}\nOriginal error: ${error.originalError.message}`;
    }

    return error.message;
}
