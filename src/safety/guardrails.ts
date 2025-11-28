/**
 * Safety Guardrails for Autonomous Code Agents
 *
 * Based on best practices from:
 * - Anthropic Claude Code Best Practices
 * - OpenSSF Security-Focused Guide for AI Code Assistants
 * - VeriGuard Framework principles
 *
 * @see https://www.anthropic.com/engineering/claude-code-best-practices
 * @see https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface SafetyCheckResult {
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
}

export interface FileChange {
    path: string;
    originalContent: string;
    newContent: string;
    timestamp: number;
}

export interface Checkpoint {
    id: string;
    timestamp: number;
    description: string;
    changes: FileChange[];
    gitRef?: string;
}

/**
 * Core safety rules that agents MUST follow
 */
export const SAFETY_RULES = {
    // Files that should NEVER be modified without explicit user confirmation
    PROTECTED_PATTERNS: [
        /\.env$/,
        /\.env\..*/,
        /credentials\./i,
        /secrets?\./i,
        /\.pem$/,
        /\.key$/,
        /id_rsa/,
        /\.ssh\//,
        /package-lock\.json$/,
        /yarn\.lock$/,
        /pnpm-lock\.yaml$/,
        /Gemfile\.lock$/,
        /poetry\.lock$/,
        /Cargo\.lock$/,
        /go\.sum$/,
    ],

    // Directories that should never be modified
    FORBIDDEN_DIRS: [
        'node_modules',
        '.git',
        '__pycache__',
        '.venv',
        'venv',
        'dist',
        'build',
        '.next',
        '.nuxt',
    ],

    // Maximum file size to modify (prevent accidental large file corruption)
    MAX_FILE_SIZE: 1024 * 1024, // 1MB

    // Maximum number of files to modify in a single operation
    MAX_FILES_PER_BATCH: 10,

    // Maximum number of destructive operations per minute
    RATE_LIMIT: {
        writes: 20,
        deletes: 5,
        windowMs: 60000,
    },

    // Require explicit confirmation for these operations
    REQUIRES_CONFIRMATION: [
        'delete_file',
        'delete_directory',
        'git_force_push',
        'git_reset_hard',
        'drop_table',
        'truncate',
        'rm -rf',
    ],
};

/**
 * Safety Guardrails Manager
 * Implements VeriGuard-inspired dual-stage validation
 */
export class SafetyGuardrails {
    private workspaceRoot: string;
    private checkpoints: Map<string, Checkpoint> = new Map();
    private operationLog: Array<{ type: string; timestamp: number }> = [];
    private fileBackups: Map<string, string> = new Map();

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    // ===== STAGE 1: PRE-EXECUTION VALIDATION =====

    /**
     * Check if a file operation is safe to perform
     */
    checkFileOperation(filePath: string, operation: 'read' | 'write' | 'delete'): SafetyCheckResult {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);
        const relativePath = path.relative(this.workspaceRoot, absolutePath);

        // Check if outside workspace
        if (relativePath.startsWith('..')) {
            return {
                allowed: false,
                reason: `Operation outside workspace not allowed: ${filePath}`
            };
        }

        // Check forbidden directories
        for (const forbidden of SAFETY_RULES.FORBIDDEN_DIRS) {
            if (relativePath.startsWith(forbidden + path.sep) || relativePath === forbidden) {
                return {
                    allowed: false,
                    reason: `Cannot modify files in ${forbidden}/`
                };
            }
        }

        // Check protected patterns (require confirmation)
        if (operation !== 'read') {
            for (const pattern of SAFETY_RULES.PROTECTED_PATTERNS) {
                if (pattern.test(relativePath)) {
                    return {
                        allowed: true,
                        requiresConfirmation: true,
                        reason: `Protected file requires confirmation: ${relativePath}`
                    };
                }
            }
        }

        // Check file size for writes
        if (operation === 'write' && fs.existsSync(absolutePath)) {
            const stats = fs.statSync(absolutePath);
            if (stats.size > SAFETY_RULES.MAX_FILE_SIZE) {
                return {
                    allowed: false,
                    reason: `File too large to modify safely: ${stats.size} bytes`
                };
            }
        }

        // Rate limiting
        if (operation === 'write' || operation === 'delete') {
            const rateCheck = this.checkRateLimit(operation);
            if (!rateCheck.allowed) {
                return rateCheck;
            }
        }

        return { allowed: true };
    }

    /**
     * Rate limit destructive operations
     */
    private checkRateLimit(operation: 'write' | 'delete'): SafetyCheckResult {
        const now = Date.now();
        const windowStart = now - SAFETY_RULES.RATE_LIMIT.windowMs;

        // Clean old entries
        this.operationLog = this.operationLog.filter(op => op.timestamp > windowStart);

        const recentOps = this.operationLog.filter(op => op.type === operation).length;
        const limit = operation === 'delete'
            ? SAFETY_RULES.RATE_LIMIT.deletes
            : SAFETY_RULES.RATE_LIMIT.writes;

        if (recentOps >= limit) {
            return {
                allowed: false,
                reason: `Rate limit exceeded: ${recentOps}/${limit} ${operation}s in the last minute. Please wait.`
            };
        }

        this.operationLog.push({ type: operation, timestamp: now });
        return { allowed: true };
    }

    /**
     * Validate command safety
     */
    checkCommand(command: string): SafetyCheckResult {
        const dangerous = [
            /rm\s+-rf\s+[\/~]/,
            /rm\s+-rf\s+\*/,
            /:\s*>\s*\//,
            /dd\s+if=/,
            /mkfs\./,
            /format\s+/i,
            /del\s+\/[sq]/i,
            /rd\s+\/s/i,
            /> \/dev\//,
            /chmod\s+-R\s+777/,
            /git\s+push\s+.*--force/,
            /git\s+reset\s+--hard/,
            /DROP\s+DATABASE/i,
            /DROP\s+TABLE/i,
            /TRUNCATE/i,
        ];

        for (const pattern of dangerous) {
            if (pattern.test(command)) {
                return {
                    allowed: false,
                    reason: `Dangerous command blocked: ${command.substring(0, 50)}...`,
                    requiresConfirmation: true
                };
            }
        }

        return { allowed: true };
    }

    // ===== STAGE 2: SYNTAX VALIDATION =====

    /**
     * Validate syntax of code before writing
     */
    validateSyntax(filePath: string, content: string): ValidationResult {
        const ext = path.extname(filePath).toLowerCase();
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            switch (ext) {
                case '.json':
                    JSON.parse(content);
                    break;

                case '.py':
                    // Use Python's compile to check syntax
                    const pyResult = this.checkPythonSyntax(content);
                    if (!pyResult.valid) {
                        errors.push(...pyResult.errors);
                    }
                    break;

                case '.ts':
                case '.tsx':
                    // TypeScript syntax check via tsc
                    const tsResult = this.checkTypeScriptSyntax(filePath, content);
                    if (!tsResult.valid) {
                        errors.push(...tsResult.errors);
                    }
                    break;

                case '.js':
                case '.jsx':
                case '.mjs':
                    // JavaScript syntax check via Node
                    const jsResult = this.checkJavaScriptSyntax(content);
                    if (!jsResult.valid) {
                        errors.push(...jsResult.errors);
                    }
                    break;

                case '.yaml':
                case '.yml':
                    // Basic YAML validation
                    const yamlResult = this.checkYamlSyntax(content);
                    if (!yamlResult.valid) {
                        errors.push(...yamlResult.errors);
                    }
                    break;
            }
        } catch (e: any) {
            errors.push(`Syntax validation failed: ${e.message}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    private checkPythonSyntax(content: string): ValidationResult {
        const errors: string[] = [];
        try {
            // Write to temp file and check with Python
            const tempFile = path.join(this.workspaceRoot, '.liftoff_temp_syntax_check.py');
            fs.writeFileSync(tempFile, content);
            try {
                execSync(`python -m py_compile "${tempFile}"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch (e: any) {
                errors.push(e.stderr || e.message);
            } finally {
                fs.unlinkSync(tempFile);
            }
        } catch (e: any) {
            // If Python check fails entirely, return a warning instead
            return { valid: true, errors: [], warnings: [`Could not validate Python syntax: ${e.message}`] };
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private checkTypeScriptSyntax(filePath: string, content: string): ValidationResult {
        const errors: string[] = [];
        try {
            const tempFile = path.join(this.workspaceRoot, '.liftoff_temp_syntax_check.ts');
            fs.writeFileSync(tempFile, content);
            try {
                execSync(`npx tsc --noEmit --skipLibCheck "${tempFile}"`, {
                    encoding: 'utf-8',
                    cwd: this.workspaceRoot,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch (e: any) {
                const output = e.stdout || e.stderr || e.message;
                // Only include actual errors, not path noise
                const lines = output.split('\n').filter((l: string) => l.includes('error TS'));
                if (lines.length > 0) {
                    errors.push(...lines.slice(0, 5)); // First 5 errors
                }
            } finally {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        } catch (e: any) {
            return { valid: true, errors: [], warnings: [`Could not validate TypeScript syntax: ${e.message}`] };
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private checkJavaScriptSyntax(content: string): ValidationResult {
        const errors: string[] = [];
        try {
            // Use Node's vm to check syntax
            new Function(content);
        } catch (e: any) {
            errors.push(e.message);
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private checkYamlSyntax(content: string): ValidationResult {
        const errors: string[] = [];
        // Basic YAML structure check
        const lines = content.split('\n');
        let indentStack: number[] = [0];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '' || line.trim().startsWith('#')) continue;

            const indent = line.search(/\S/);
            if (indent === -1) continue;

            // Check for tabs (YAML shouldn't have tabs)
            if (line.includes('\t')) {
                errors.push(`Line ${i + 1}: Tabs not allowed in YAML`);
            }
        }

        return { valid: errors.length === 0, errors, warnings: [] };
    }

    // ===== CHECKPOINTS & ROLLBACK =====

    /**
     * Create a checkpoint before making changes
     */
    createCheckpoint(description: string): string {
        const id = `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        // Try to create a git stash as backup
        let gitRef: string | undefined;
        try {
            const status = execSync('git status --porcelain', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8'
            });
            if (status.trim()) {
                execSync(`git stash push -m "liftoff-checkpoint-${id}"`, {
                    cwd: this.workspaceRoot,
                    encoding: 'utf-8'
                });
                gitRef = id;
                // Immediately pop to keep working
                execSync('git stash pop', { cwd: this.workspaceRoot });
            }
        } catch (e) {
            // Git not available or not a repo, continue without
        }

        const checkpoint: Checkpoint = {
            id,
            timestamp: Date.now(),
            description,
            changes: [],
            gitRef
        };

        this.checkpoints.set(id, checkpoint);
        return id;
    }

    /**
     * Backup file content before modification
     */
    backupFile(filePath: string): void {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);

        if (fs.existsSync(absolutePath)) {
            this.fileBackups.set(absolutePath, fs.readFileSync(absolutePath, 'utf-8'));
        }
    }

    /**
     * Restore file from backup
     */
    restoreFile(filePath: string): boolean {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);

        const backup = this.fileBackups.get(absolutePath);
        if (backup !== undefined) {
            fs.writeFileSync(absolutePath, backup, 'utf-8');
            return true;
        }
        return false;
    }

    /**
     * Rollback all changes since checkpoint
     */
    rollback(checkpointId: string): boolean {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (!checkpoint) return false;

        // Restore files
        for (const change of checkpoint.changes) {
            const absolutePath = path.join(this.workspaceRoot, change.path);
            fs.writeFileSync(absolutePath, change.originalContent, 'utf-8');
        }

        return true;
    }

    /**
     * Record a file change in the current checkpoint
     */
    recordChange(checkpointId: string, filePath: string, originalContent: string, newContent: string): void {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (checkpoint) {
            checkpoint.changes.push({
                path: filePath,
                originalContent,
                newContent,
                timestamp: Date.now()
            });
        }
    }

    // ===== RCI (RECURSIVE CRITICISM & IMPROVEMENT) =====

    /**
     * Generate self-critique prompt for code changes
     */
    generateRCIPrompt(originalCode: string, modifiedCode: string, filePath: string): string {
        return `Review this code modification for problems:

FILE: ${filePath}

ORIGINAL:
\`\`\`
${originalCode.substring(0, 2000)}
\`\`\`

MODIFIED:
\`\`\`
${modifiedCode.substring(0, 2000)}
\`\`\`

Check for:
1. Syntax errors (missing brackets, quotes, semicolons)
2. Logic errors (wrong variable names, incorrect conditions)
3. Security issues (hardcoded secrets, injection vulnerabilities)
4. Breaking changes (removed functionality, changed interfaces)
5. Incomplete changes (TODO comments, placeholder code)

List any problems found, or respond with "NO_ISSUES" if the change looks correct.`;
    }

    /**
     * Analyze code diff for potential issues
     */
    analyzeDiff(original: string, modified: string): string[] {
        const issues: string[] = [];

        // Check for removed functionality
        const originalFunctions: string[] = original.match(/(?:function|def|const|let|var)\s+(\w+)/g) || [];
        const modifiedFunctions: string[] = modified.match(/(?:function|def|const|let|var)\s+(\w+)/g) || [];

        for (const fn of originalFunctions) {
            if (!modifiedFunctions.includes(fn)) {
                issues.push(`Potential removed function: ${fn}`);
            }
        }

        // Check for hardcoded secrets
        const secretPatterns = [
            /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
            /password\s*[=:]\s*['"][^'"]+['"]/i,
            /secret\s*[=:]\s*['"][^'"]+['"]/i,
            /token\s*[=:]\s*['"][^'"]+['"]/i,
        ];
        for (const pattern of secretPatterns) {
            if (pattern.test(modified) && !pattern.test(original)) {
                issues.push('Warning: Possible hardcoded secret added');
            }
        }

        // Check for TODO/FIXME
        if ((modified.match(/TODO|FIXME|XXX/gi) || []).length > (original.match(/TODO|FIXME|XXX/gi) || []).length) {
            issues.push('Warning: New TODO/FIXME comments added - ensure these are addressed');
        }

        return issues;
    }

    // ===== BATCH OPERATION SAFETY =====

    /**
     * Check if a batch of file operations is safe
     */
    checkBatchOperation(files: string[], operation: 'write' | 'delete'): SafetyCheckResult {
        if (files.length > SAFETY_RULES.MAX_FILES_PER_BATCH) {
            return {
                allowed: false,
                reason: `Too many files (${files.length}) in batch operation. Max allowed: ${SAFETY_RULES.MAX_FILES_PER_BATCH}`
            };
        }

        const issues: string[] = [];
        for (const file of files) {
            const check = this.checkFileOperation(file, operation);
            if (!check.allowed) {
                issues.push(`${file}: ${check.reason}`);
            }
        }

        if (issues.length > 0) {
            return {
                allowed: false,
                reason: `Batch operation blocked:\n${issues.join('\n')}`
            };
        }

        return { allowed: true };
    }

    /**
     * Get safety status summary
     */
    getStatus(): {
        checkpointCount: number;
        backupCount: number;
        recentOperations: number;
    } {
        const now = Date.now();
        const windowStart = now - SAFETY_RULES.RATE_LIMIT.windowMs;

        return {
            checkpointCount: this.checkpoints.size,
            backupCount: this.fileBackups.size,
            recentOperations: this.operationLog.filter(op => op.timestamp > windowStart).length
        };
    }
}

/**
 * Create safety rules documentation for agent prompts
 */
export function getSafetyRulesForPrompt(): string {
    return `
# SAFETY RULES (MUST FOLLOW)

## Before ANY Code Modification:
1. READ the file first to understand context
2. VALIDATE your change won't break syntax
3. BACKUP: Changes can be rolled back if needed
4. VERIFY after writing that the change works

## NEVER Do:
- Modify files in node_modules/, .git/, or vendor directories
- Write to .env, credentials, or key files without asking
- Use string replace blindly - understand the full context
- Make more than 10 file changes in a single operation
- Run dangerous commands (rm -rf, DROP TABLE, etc.)

## ALWAYS Do:
- Read entire functions/classes before modifying them
- Check for syntax errors after edits
- Run tests after making changes
- Ask for confirmation before deleting files

## If You Made a Mistake:
- STOP immediately
- Report the error clearly
- Don't try to "fix" with more blind changes
- Ask for help rolling back if needed

## Code Change Process:
1. Read target file
2. Identify exact location to change
3. Make minimal, focused change
4. Validate syntax
5. Test the change
6. Move to next task only if successful
`;
}
