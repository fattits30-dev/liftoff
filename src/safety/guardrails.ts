/**
 * Safety Guardrails for Autonomous Code Agents
 *
 * Based on best practices from:
 * - Anthropic Claude Code Best Practices
 * - OpenSSF Security-Focused Guide for AI Code Assistants
 * - VeriGuard Framework principles
 * 
 * All I/O operations are async to prevent blocking the extension host.
 *
 * @see https://www.anthropic.com/engineering/claude-code-best-practices
 * @see https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

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

    MAX_FILE_SIZE: 1024 * 1024, // 1MB
    MAX_FILES_PER_BATCH: 10,

    RATE_LIMIT: {
        writes: 20,
        deletes: 5,
        windowMs: 60000,
    },

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

// Helper to check file existence (async)
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}


/**
 * Safety Guardrails Manager
 * Implements VeriGuard-inspired dual-stage validation
 * All I/O is async to prevent blocking
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
     * Check if a file operation is safe to perform (async)
     */
    async checkFileOperation(filePath: string, operation: 'read' | 'write' | 'delete'): Promise<SafetyCheckResult> {
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

        // Check file size for writes (async)
        if (operation === 'write' && await fileExists(absolutePath)) {
            try {
                const stats = await fs.stat(absolutePath);
                if (stats.size > SAFETY_RULES.MAX_FILE_SIZE) {
                    return {
                        allowed: false,
                        reason: `File too large to modify safely: ${stats.size} bytes`
                    };
                }
            } catch {
                // File doesn't exist or can't be accessed, allow the write
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
     * Rate limit destructive operations (sync - just in-memory)
     */
    private checkRateLimit(operation: 'write' | 'delete'): SafetyCheckResult {
        const now = Date.now();
        const windowStart = now - SAFETY_RULES.RATE_LIMIT.windowMs;

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
     * Validate command safety (sync - just regex, no I/O)
     */
    checkCommand(command: string): SafetyCheckResult {
        const normalizedCmd = command.replace(/\s+/g, ' ').trim();
        
        // Command injection patterns
        const injectionPatterns = [
            /;\s*(sudo\s+)?rm\s/i,
            /&&\s*(sudo\s+)?rm\s/i,
            /\|\|\s*(sudo\s+)?rm\s/i,
            /`.*rm\s/i,
            /\$\(.*rm\s/i,
            /;\s*(sudo\s+)?del\s/i,
            /&&\s*(sudo\s+)?del\s/i,
            /;\s*(sudo\s+)?rd\s/i,
            /&&\s*(sudo\s+)?rd\s/i,
            /;\s*(sudo\s+)?format\s/i,
            /;\s*(sudo\s+)?dd\s/i,
            /;\s*(sudo\s+)?mkfs/i,
            /;\s*curl\s.*\|\s*(sudo\s+)?sh/i,
            /;\s*wget\s.*\|\s*(sudo\s+)?sh/i,
            /&&\s*curl\s.*\|\s*(sudo\s+)?sh/i,
            /&&\s*wget\s.*\|\s*(sudo\s+)?sh/i,
            /\|\s*(sudo\s+)?bash$/i,
            /\|\s*(sudo\s+)?sh$/i,
            /\|\s*python[23]?\s+-c/i,
            /\|\s*node\s+-e/i,
            /\beval\s+/i,
            /\bexec\s+/i,
            /\$\{.*\}/,
        ];

        for (const pattern of injectionPatterns) {
            if (pattern.test(normalizedCmd)) {
                return {
                    allowed: false,
                    reason: `Command injection attempt detected: ${normalizedCmd.substring(0, 50)}...`,
                    requiresConfirmation: false
                };
            }
        }

        // Dangerous commands
        const dangerous = [
            /(sudo\s+)?rm\s+-rf\s+[/~]/i,
            /(sudo\s+)?rm\s+-rf\s+\*/i,
            /(sudo\s+)?rm\s+-rf\s+\.\./i,
            /(sudo\s+)?rm\s+-rf\s+\.$/i,
            /:\s*>\s*\//,
            /(sudo\s+)?dd\s+if=/i,
            /(sudo\s+)?mkfs\./i,
            /format\s+[a-z]:/i,
            /del\s+\/[sq]/i,
            /rd\s+\/s/i,
            />\s*\/dev\//,
            /(sudo\s+)?chmod\s+-R\s+777/i,
            /git\s+push\s+.*--force/i,
            /git\s+reset\s+--hard/i,
            /DROP\s+DATABASE/i,
            /DROP\s+TABLE/i,
            /TRUNCATE/i,
            /(sudo\s+)?shutdown/i,
            /(sudo\s+)?reboot/i,
            /(sudo\s+)?init\s+0/i,
            /(sudo\s+)?systemctl\s+(stop|disable)\s+/i,
            /(sudo\s+)?kill\s+-9\s+1$/i,
            />\s*\/etc\//i,
            /(sudo\s+)?chown\s+-R\s+/i,
            /(sudo\s+)?passwd/i,
            /(sudo\s+)?userdel/i,
            /base64\s+-d.*\|\s*sh/i,
        ];

        for (const pattern of dangerous) {
            if (pattern.test(normalizedCmd)) {
                return {
                    allowed: false,
                    reason: `Dangerous command blocked: ${normalizedCmd.substring(0, 50)}...`,
                    requiresConfirmation: true
                };
            }
        }

        return { allowed: true };
    }


    // ===== STAGE 2: SYNTAX VALIDATION (async) =====

    /**
     * Validate syntax of code before writing (async)
     */
    async validateSyntax(filePath: string, content: string): Promise<ValidationResult> {
        const ext = path.extname(filePath).toLowerCase();
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            switch (ext) {
                case '.json':
                    JSON.parse(content);
                    break;

                case '.py':
                    const pyResult = await this.checkPythonSyntax(content);
                    if (!pyResult.valid) {
                        errors.push(...pyResult.errors);
                    }
                    break;

                case '.ts':
                case '.tsx':
                    const tsResult = await this.checkTypeScriptSyntax(content);
                    if (!tsResult.valid) {
                        errors.push(...tsResult.errors);
                    }
                    break;

                case '.js':
                case '.jsx':
                case '.mjs':
                    const jsResult = this.checkJavaScriptSyntax(content);
                    if (!jsResult.valid) {
                        errors.push(...jsResult.errors);
                    }
                    break;

                case '.yaml':
                case '.yml':
                    const yamlResult = this.checkYamlSyntax(content);
                    if (!yamlResult.valid) {
                        errors.push(...yamlResult.errors);
                    }
                    break;
            }
        } catch (e: any) {
            errors.push(`Syntax validation failed: ${e.message}`);
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private async checkPythonSyntax(content: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const tempFile = path.join(os.tmpdir(), `.liftoff_syntax_${Date.now()}.py`);
        
        try {
            await fs.writeFile(tempFile, content);
            try {
                await execAsync(`python -m py_compile "${tempFile}"`);
            } catch (e: any) {
                errors.push(e.stderr || e.message);
            } finally {
                await fs.unlink(tempFile).catch(() => {});
            }
        } catch (e: any) {
            return { valid: true, errors: [], warnings: [`Could not validate Python syntax: ${e.message}`] };
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private async checkTypeScriptSyntax(content: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const tempFile = path.join(os.tmpdir(), `.liftoff_syntax_${Date.now()}.ts`);
        
        try {
            await fs.writeFile(tempFile, content);
            try {
                await execAsync(`npx tsc --noEmit --skipLibCheck "${tempFile}"`, { cwd: this.workspaceRoot });
            } catch (e: any) {
                const output = e.stdout || e.stderr || e.message;
                const lines = output.split('\n').filter((l: string) => l.includes('error TS'));
                if (lines.length > 0) {
                    errors.push(...lines.slice(0, 5));
                }
            } finally {
                await fs.unlink(tempFile).catch(() => {});
            }
        } catch (e: any) {
            return { valid: true, errors: [], warnings: [`Could not validate TypeScript syntax: ${e.message}`] };
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private checkJavaScriptSyntax(content: string): ValidationResult {
        const errors: string[] = [];
        try {
            new Function(content);
        } catch (e: any) {
            errors.push(e.message);
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    private checkYamlSyntax(content: string): ValidationResult {
        const errors: string[] = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '' || line.trim().startsWith('#')) continue;
            if (line.includes('\t')) {
                errors.push(`Line ${i + 1}: Tabs not allowed in YAML`);
            }
        }

        return { valid: errors.length === 0, errors, warnings: [] };
    }


    // ===== CHECKPOINTS & ROLLBACK (async) =====

    /**
     * Create a checkpoint before making changes (async)
     */
    async createCheckpoint(description: string): Promise<string> {
        const id = `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        let gitRef: string | undefined;
        try {
            const { stdout: status } = await execAsync('git status --porcelain', { cwd: this.workspaceRoot });
            if (status.trim()) {
                await execAsync(`git stash push -m "liftoff-checkpoint-${id}"`, { cwd: this.workspaceRoot });
                gitRef = id;
                await execAsync('git stash pop', { cwd: this.workspaceRoot });
            }
        } catch {
            // Git not available or not a repo
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
     * Backup file content before modification (async)
     */
    async backupFile(filePath: string): Promise<void> {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);

        if (await fileExists(absolutePath)) {
            const content = await fs.readFile(absolutePath, 'utf-8');
            this.fileBackups.set(absolutePath, content);
        }
    }

    /**
     * Restore file from backup (async)
     */
    async restoreFile(filePath: string): Promise<boolean> {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);

        const backup = this.fileBackups.get(absolutePath);
        if (backup !== undefined) {
            await fs.writeFile(absolutePath, backup, 'utf-8');
            return true;
        }
        return false;
    }

    /**
     * Rollback all changes since checkpoint (async)
     */
    async rollback(checkpointId: string): Promise<boolean> {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (!checkpoint) return false;

        for (const change of checkpoint.changes) {
            const absolutePath = path.join(this.workspaceRoot, change.path);
            await fs.writeFile(absolutePath, change.originalContent, 'utf-8');
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

    analyzeDiff(original: string, modified: string): string[] {
        const issues: string[] = [];

        const originalFunctions: string[] = original.match(/(?:function|def|const|let|var)\s+(\w+)/g) || [];
        const modifiedFunctions: string[] = modified.match(/(?:function|def|const|let|var)\s+(\w+)/g) || [];

        for (const fn of originalFunctions) {
            if (!modifiedFunctions.includes(fn)) {
                issues.push(`Potential removed function: ${fn}`);
            }
        }

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

        if ((modified.match(/TODO|FIXME|XXX/gi) || []).length > (original.match(/TODO|FIXME|XXX/gi) || []).length) {
            issues.push('Warning: New TODO/FIXME comments added - ensure these are addressed');
        }

        return issues;
    }

    // ===== BATCH OPERATION SAFETY =====

    async checkBatchOperation(files: string[], operation: 'write' | 'delete'): Promise<SafetyCheckResult> {
        if (files.length > SAFETY_RULES.MAX_FILES_PER_BATCH) {
            return {
                allowed: false,
                reason: `Too many files (${files.length}) in batch operation. Max allowed: ${SAFETY_RULES.MAX_FILES_PER_BATCH}`
            };
        }

        const issues: string[] = [];
        for (const file of files) {
            const check = await this.checkFileOperation(file, operation);
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

    getStatus(): { checkpointCount: number; backupCount: number; recentOperations: number } {
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
