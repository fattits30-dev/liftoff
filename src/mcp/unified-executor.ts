/**
 * Unified Code Executor - Single "execute" tool that wraps all capabilities
 *
 * Follows Anthropic's code executor pattern for 98% token reduction.
 * Instead of exposing 50+ tools, agents get ONE tool: execute({ code: "..." })
 *
 * Security Model: Workspace + Home
 * - WRITE: workspace only (with validation + backup)
 * - READ: workspace + home directory
 * - BLOCKED: .env, .ssh, .aws, credentials, node_modules, .git/objects
 *
 * Safety Features (based on Anthropic & OpenSSF best practices):
 * - Pre-write syntax validation
 * - Automatic file backup before modifications
 * - Rate limiting for destructive operations
 * - Protected file patterns
 * - Diff analysis for risky changes
 *
 * @see https://www.anthropic.com/engineering/claude-code-best-practices
 * @see https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import { execSync, spawn } from 'child_process';
import * as vm from 'vm';
import * as vscode from 'vscode';
import { SafetyGuardrails, getSafetyRulesForPrompt } from '../safety/guardrails';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionContext {
    workspaceRoot: string;
    timeout?: number;
}

export interface ExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
    duration: number;
}

export interface ElementInfo {
    tag: string;
    text: string;
    attributes: Record<string, string>;
}

// ============================================================================
// Security Layer
// ============================================================================

const PROTECTED_PATHS = [
    '.env',           // Secrets
    'node_modules',   // Dependencies (too large)
    '.git/objects',   // Git internals
    '.ssh',           // SSH keys
    '.gnupg',         // GPG keys
    'credentials',    // Generic credentials
    '.aws',           // AWS credentials
    '.azure',         // Azure credentials
    '.gcp',           // GCP credentials
    'secrets',        // Generic secrets
];

function isProtectedPath(fullPath: string): boolean {
    const normalized = fullPath.replace(/\\/g, '/').toLowerCase();
    return PROTECTED_PATHS.some(p => normalized.includes(p.toLowerCase()));
}

function validatePath(
    relativePath: string,
    workspaceRoot: string,
    operation: 'read' | 'write'
): string {
    // Resolve to absolute path
    const fullPath = nodePath.isAbsolute(relativePath)
        ? relativePath
        : nodePath.resolve(workspaceRoot, relativePath);

    // Normalize for comparison
    const normalizedPath = nodePath.normalize(fullPath);
    const normalizedWorkspace = nodePath.normalize(workspaceRoot);
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const normalizedHome = homeDir ? nodePath.normalize(homeDir) : '';

    // Check protected paths
    if (isProtectedPath(normalizedPath)) {
        throw new Error(`Access denied: protected path - ${relativePath}`);
    }

    // WRITE: workspace only
    if (operation === 'write') {
        if (!normalizedPath.startsWith(normalizedWorkspace)) {
            throw new Error(`Write access denied: must be within workspace - ${relativePath}`);
        }
    }

    // READ: workspace + home directory
    if (operation === 'read') {
        const inWorkspace = normalizedPath.startsWith(normalizedWorkspace);
        const inHome = normalizedHome && normalizedPath.startsWith(normalizedHome);

        if (!inWorkspace && !inHome) {
            throw new Error(`Read access denied: must be workspace or home - ${relativePath}`);
        }
    }

    return fullPath;
}

// ============================================================================
// Browser Manager (Lazy Initialization)
// ============================================================================

class BrowserManager {
    private browser: any = null;
    private page: any = null;
    private playwright: any = null;

    async ensureBrowser(): Promise<any> {
        if (!this.browser) {
            try {
                // Dynamic import to avoid requiring playwright if not used
                this.playwright = await import('playwright');
                this.browser = await this.playwright.chromium.launch({ headless: true });
                this.page = await this.browser.newPage();
            } catch (err: any) {
                throw new Error(`Browser init failed (install playwright): ${err.message}`);
            }
        }
        return this.page;
    }

    async navigate(url: string): Promise<void> {
        const page = await this.ensureBrowser();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    async click(selector: string): Promise<void> {
        const page = await this.ensureBrowser();
        await page.click(selector);
    }

    async type(selector: string, text: string): Promise<void> {
        const page = await this.ensureBrowser();
        await page.fill(selector, text);
    }

    async screenshot(savePath?: string): Promise<string> {
        const page = await this.ensureBrowser();
        const buffer = await page.screenshot({ path: savePath, fullPage: true });
        return savePath || buffer.toString('base64');
    }

    async getText(selector: string): Promise<string> {
        const page = await this.ensureBrowser();
        return await page.textContent(selector) || '';
    }

    async getElements(selector: string): Promise<ElementInfo[]> {
        const page = await this.ensureBrowser();
        return await page.$$eval(selector, (elements: Element[]) =>
            elements.map(el => ({
                tag: el.tagName.toLowerCase(),
                text: el.textContent?.trim() || '',
                attributes: Object.fromEntries(
                    Array.from(el.attributes).map(attr => [attr.name, attr.value])
                )
            }))
        );
    }

    async waitFor(selector: string, timeout: number = 5000): Promise<void> {
        const page = await this.ensureBrowser();
        await page.waitForSelector(selector, { timeout });
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

// ============================================================================
// VS Code Integration
// ============================================================================

function createVSCodeAPI() {
    return {
        getProblems: (): Array<{ file: string; line: number; message: string; severity: string }> => {
            const diagnostics = vscode.languages.getDiagnostics();
            const problems: Array<{ file: string; line: number; message: string; severity: string }> = [];

            for (const [uri, fileDiagnostics] of diagnostics) {
                for (const diag of fileDiagnostics) {
                    problems.push({
                        file: uri.fsPath,
                        line: diag.range.start.line + 1,
                        message: diag.message,
                        severity: vscode.DiagnosticSeverity[diag.severity]
                    });
                }
            }
            return problems;
        },

        openFile: (filePath: string, line?: number): void => {
            const uri = vscode.Uri.file(filePath);
            vscode.window.showTextDocument(uri).then(editor => {
                if (line !== undefined) {
                    const position = new vscode.Position(line - 1, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                }
            });
        },

        showDiff: (original: string, modified: string): void => {
            const originalUri = vscode.Uri.parse(`untitled:Original`);
            const modifiedUri = vscode.Uri.parse(`untitled:Modified`);
            vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, 'Diff');
        },

        getOpenFiles: (): string[] => {
            return vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .filter(tab => tab.input instanceof vscode.TabInputText)
                .map(tab => (tab.input as vscode.TabInputText).uri.fsPath);
        },

        getSelection: (): { file: string; text: string; range: { start: number; end: number } } | null => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return null;

            return {
                file: editor.document.uri.fsPath,
                text: editor.document.getText(editor.selection),
                range: {
                    start: editor.selection.start.line + 1,
                    end: editor.selection.end.line + 1
                }
            };
        }
    };
}

// ============================================================================
// Sandbox Factory
// ============================================================================

function createSandbox(workspaceRoot: string, browserManager: BrowserManager, guardrails: SafetyGuardrails) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    return {
        // File System API (with security)
        fs: {
            read: (filePath: string): string => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'read');
                    return fs.readFileSync(fullPath, 'utf-8');
                } catch (err: any) {
                    throw new Error(`Failed to read ${filePath}: ${err.message}`);
                }
            },

            write: (filePath: string, content: string): string => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'write');

                    // Safety check: Rate limiting and protected file check
                    const safetyCheck = guardrails.checkFileOperation(filePath, 'write');
                    if (!safetyCheck.allowed) {
                        throw new Error(`Safety blocked: ${safetyCheck.reason}`);
                    }
                    if (safetyCheck.requiresConfirmation) {
                        throw new Error(`Protected file requires confirmation: ${filePath}. Use fs.writeForce() if you're sure.`);
                    }

                    // Backup existing file before modification
                    if (fs.existsSync(fullPath)) {
                        guardrails.backupFile(fullPath);
                    }

                    // Validate syntax before writing
                    const validation = guardrails.validateSyntax(filePath, content);
                    if (!validation.valid) {
                        throw new Error(`Syntax validation failed:\n${validation.errors.join('\n')}`);
                    }

                    // Analyze diff for potential issues
                    if (fs.existsSync(fullPath)) {
                        const original = fs.readFileSync(fullPath, 'utf-8');
                        const issues = guardrails.analyzeDiff(original, content);
                        if (issues.length > 0) {
                            // Log warnings but don't block
                            console.warn(`[SafetyWarning] ${filePath}:\n${issues.join('\n')}`);
                        }
                    }

                    // Write file
                    fs.mkdirSync(nodePath.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, content, 'utf-8');
                    return `Written ${content.length} bytes to ${filePath}`;
                } catch (err: any) {
                    throw new Error(`Failed to write ${filePath}: ${err.message}`);
                }
            },

            // Force write (bypasses confirmation for protected files, but still validates syntax)
            writeForce: (filePath: string, content: string): string => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'write');

                    // Still validate syntax even for forced writes
                    const validation = guardrails.validateSyntax(filePath, content);
                    if (!validation.valid) {
                        throw new Error(`Syntax validation failed:\n${validation.errors.join('\n')}`);
                    }

                    // Backup existing file before modification
                    if (fs.existsSync(fullPath)) {
                        guardrails.backupFile(fullPath);
                    }

                    fs.mkdirSync(nodePath.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, content, 'utf-8');
                    return `[FORCE] Written ${content.length} bytes to ${filePath}`;
                } catch (err: any) {
                    throw new Error(`Failed to write ${filePath}: ${err.message}`);
                }
            },

            // Restore file from backup
            restore: (filePath: string): string => {
                if (guardrails.restoreFile(filePath)) {
                    return `Restored ${filePath} from backup`;
                }
                throw new Error(`No backup found for ${filePath}`);
            },

            exists: (filePath: string): boolean => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'read');
                    return fs.existsSync(fullPath);
                } catch {
                    return false;
                }
            },

            list: (dirPath: string = '.', options?: { recursive?: boolean }): string[] => {
                const fullPath = validatePath(dirPath, workspaceRoot, 'read');

                if (options?.recursive) {
                    const results: string[] = [];
                    const walk = (dir: string, prefix: string = '') => {
                        try {
                            const entries = fs.readdirSync(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                // Skip protected and hidden directories
                                if (entry.name.startsWith('.') || isProtectedPath(entry.name)) {
                                    continue;
                                }

                                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                                if (entry.isDirectory()) {
                                    walk(nodePath.join(dir, entry.name), relPath);
                                } else {
                                    results.push(relPath);
                                }
                            }
                        } catch {}
                    };
                    walk(fullPath);
                    return results;
                }

                return fs.readdirSync(fullPath).filter(f => !isProtectedPath(f));
            },

            delete: (filePath: string): string => {
                const fullPath = validatePath(filePath, workspaceRoot, 'write');

                // Safety check: Rate limiting
                const safetyCheck = guardrails.checkFileOperation(filePath, 'delete');
                if (!safetyCheck.allowed) {
                    throw new Error(`Safety blocked: ${safetyCheck.reason}`);
                }

                // Backup before delete
                if (fs.existsSync(fullPath)) {
                    guardrails.backupFile(fullPath);
                }

                fs.unlinkSync(fullPath);
                return `Deleted ${filePath}`;
            },

            mkdir: (dirPath: string): void => {
                const fullPath = validatePath(dirPath, workspaceRoot, 'write');
                fs.mkdirSync(fullPath, { recursive: true });
            },

            search: (pattern: RegExp, dir: string = '.'): Array<{ file: string; line: number; match: string }> => {
                const results: Array<{ file: string; line: number; match: string }> = [];
                const fullPath = validatePath(dir, workspaceRoot, 'read');

                const searchDir = (currentDir: string, prefix: string = '') => {
                    try {
                        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.') || isProtectedPath(entry.name)) {
                                continue;
                            }

                            const entryPath = nodePath.join(currentDir, entry.name);
                            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

                            if (entry.isDirectory()) {
                                searchDir(entryPath, relPath);
                            } else if (entry.isFile()) {
                                try {
                                    const content = fs.readFileSync(entryPath, 'utf-8');
                                    const lines = content.split('\n');
                                    lines.forEach((line, i) => {
                                        if (pattern.test(line)) {
                                            results.push({
                                                file: relPath,
                                                line: i + 1,
                                                match: line.trim().substring(0, 200)
                                            });
                                        }
                                    });
                                } catch {}
                            }
                        }
                    } catch {}
                };

                searchDir(fullPath);
                return results;
            },

            readHome: (relativePath: string): string => {
                if (!homeDir) {
                    throw new Error('Home directory not available');
                }
                const fullPath = nodePath.join(homeDir, relativePath);
                // Validate it's actually in home
                if (!fullPath.startsWith(homeDir)) {
                    throw new Error('Path traversal detected');
                }
                if (isProtectedPath(fullPath)) {
                    throw new Error('Access denied: protected path');
                }
                return fs.readFileSync(fullPath, 'utf-8');
            }
        },

        // Shell/Command API
        shell: {
            run: (command: string, options?: { cwd?: string; timeout?: number }): string => {
                // Safety check: Block dangerous commands
                const cmdCheck = guardrails.checkCommand(command);
                if (!cmdCheck.allowed) {
                    throw new Error(`Dangerous command blocked: ${cmdCheck.reason}`);
                }

                const cwd = options?.cwd
                    ? validatePath(options.cwd, workspaceRoot, 'read')
                    : workspaceRoot;
                try {
                    return execSync(command, {
                        cwd,
                        timeout: options?.timeout || 120000,
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        maxBuffer: 10 * 1024 * 1024 // 10MB
                    }).toString();
                } catch (err: any) {
                    // Command failed (non-zero exit code) - combine stdout + stderr + exit info
                    const stdout = err.stdout?.toString() || '';
                    const stderr = err.stderr?.toString() || '';
                    const exitCode = err.status ?? 'unknown';

                    // Return combined output with clear failure indication
                    let output = '';
                    if (stdout) output += stdout;
                    if (stderr) output += (output ? '\n' : '') + stderr;
                    if (!output) output = err.message;

                    return `[EXIT CODE: ${exitCode}]\n${output}`;
                }
            },

            runAsync: (command: string): Promise<string> => {
                return new Promise((resolve) => {
                    const proc = spawn(command, { shell: true, cwd: workspaceRoot });
                    let output = '';
                    proc.stdout?.on('data', d => output += d);
                    proc.stderr?.on('data', d => output += d);
                    proc.on('close', () => resolve(output));
                    proc.on('error', (err) => resolve(`Error: ${err.message}`));
                });
            }
        },

        // Git API
        git: {
            status: (): string => {
                try {
                    return execSync('git status --short', { cwd: workspaceRoot, encoding: 'utf-8' });
                } catch (err: any) {
                    return err.message;
                }
            },

            diff: (file?: string): string => {
                try {
                    const cmd = file ? `git diff -- "${file}"` : 'git diff';
                    return execSync(cmd, { cwd: workspaceRoot, encoding: 'utf-8' });
                } catch (err: any) {
                    return err.message;
                }
            },

            log: (n: number = 5): string => {
                try {
                    return execSync(`git log -${n} --oneline`, { cwd: workspaceRoot, encoding: 'utf-8' });
                } catch (err: any) {
                    return err.message;
                }
            },

            commit: (message: string): string => {
                try {
                    execSync('git add -A', { cwd: workspaceRoot });
                    return execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
                        cwd: workspaceRoot,
                        encoding: 'utf-8'
                    });
                } catch (err: any) {
                    return err.message;
                }
            },

            branch: (): string => {
                try {
                    return execSync('git branch --show-current', { cwd: workspaceRoot, encoding: 'utf-8' }).trim();
                } catch (err: any) {
                    return err.message;
                }
            },

            checkout: (branch: string): string => {
                try {
                    return execSync(`git checkout ${branch}`, { cwd: workspaceRoot, encoding: 'utf-8' });
                } catch (err: any) {
                    return err.message;
                }
            }
        },

        // HTTP Fetch API
        fetch: async (url: string, options?: RequestInit): Promise<any> => {
            const response = await globalThis.fetch(url, options);
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return response.json();
            }
            return response.text();
        },

        // Browser API (lazy initialized)
        browser: {
            navigate: (url: string) => browserManager.navigate(url),
            click: (selector: string) => browserManager.click(selector),
            type: (selector: string, text: string) => browserManager.type(selector, text),
            screenshot: (path?: string) => browserManager.screenshot(path),
            getText: (selector: string) => browserManager.getText(selector),
            getElements: (selector: string) => browserManager.getElements(selector),
            waitFor: (selector: string, timeout?: number) => browserManager.waitFor(selector, timeout),
            close: () => browserManager.close()
        },

        // Test helpers (for pytest/vitest/jest)
        test: {
            // Discover tests without running them
            discover: (dir: string = '.'): string => {
                const fullPath = validatePath(dir, workspaceRoot, 'read');
                try {
                    // Try pytest first
                    return execSync('python -m pytest --collect-only -q', {
                        cwd: fullPath,
                        encoding: 'utf-8',
                        timeout: 30000
                    });
                } catch {
                    try {
                        // Try vitest list (vitest uses --list or list command)
                        return execSync('npx vitest list 2>&1 || npx vitest --list 2>&1', {
                            cwd: fullPath,
                            encoding: 'utf-8',
                            timeout: 30000,
                            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
                        });
                    } catch {
                        try {
                            // Fallback: just list test files
                            const testFiles = execSync('dir /s /b *test*.ts *test*.js *spec*.ts *spec*.js 2>nul || find . -name "*test*" -o -name "*spec*" 2>/dev/null', {
                                cwd: fullPath,
                                encoding: 'utf-8',
                                timeout: 10000,
                                shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
                            });
                            return `Test files found:\n${testFiles}`;
                        } catch {
                            return 'Could not discover tests. Try running tests directly with test.run()';
                        }
                    }
                }
            },

            // Run a single test file (faster than all tests)
            runFile: (testFile: string): string => {
                const fullPath = validatePath(testFile, workspaceRoot, 'read');
                try {
                    if (testFile.endsWith('.py')) {
                        return execSync(`python -m pytest "${fullPath}" -v --tb=short`, {
                            cwd: workspaceRoot,
                            encoding: 'utf-8',
                            timeout: 120000, // 2 min per file
                            maxBuffer: 10 * 1024 * 1024
                        });
                    } else {
                        // Use vitest for TypeScript/JavaScript tests
                        return execSync(`npx vitest run "${testFile}" --reporter=verbose`, {
                            cwd: workspaceRoot,
                            encoding: 'utf-8',
                            timeout: 120000,
                            maxBuffer: 10 * 1024 * 1024
                        });
                    }
                } catch (err: any) {
                    const stdout = err.stdout?.toString() || '';
                    const stderr = err.stderr?.toString() || '';
                    return `[EXIT CODE: ${err.status}]\n${stdout}\n${stderr}`;
                }
            },

            // Run tests matching a pattern
            run: (pattern?: string, options?: { timeout?: number }): string => {
                const timeout = options?.timeout || 180000; // 3 min default
                try {
                    // Detect project type and run appropriate test command
                    const hasPytest = fs.existsSync(nodePath.join(workspaceRoot, 'pytest.ini')) ||
                                      fs.existsSync(nodePath.join(workspaceRoot, 'pyproject.toml'));
                    const hasVitest = fs.existsSync(nodePath.join(workspaceRoot, 'vitest.config.ts')) ||
                                      fs.existsSync(nodePath.join(workspaceRoot, 'vitest.config.js'));

                    let cmd: string;
                    if (hasPytest || pattern?.endsWith('.py')) {
                        cmd = pattern
                            ? `python -m pytest -k "${pattern}" -v --tb=short`
                            : 'python -m pytest -v --tb=short';
                    } else if (hasVitest) {
                        cmd = pattern
                            ? `npx vitest run "${pattern}" --reporter=verbose`
                            : 'npx vitest run --reporter=verbose';
                    } else {
                        cmd = pattern
                            ? `npm test -- "${pattern}"`
                            : 'npm test';
                    }

                    return execSync(cmd, {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        timeout,
                        maxBuffer: 10 * 1024 * 1024
                    });
                } catch (err: any) {
                    const stdout = err.stdout?.toString() || '';
                    const stderr = err.stderr?.toString() || '';
                    return `[EXIT CODE: ${err.status}]\n${stdout}\n${stderr}`;
                }
            }
        },

        // VS Code API
        vscode: createVSCodeAPI(),

        // Utility functions
        path: {
            join: (...parts: string[]) => nodePath.join(...parts),
            dirname: (p: string) => nodePath.dirname(p),
            basename: (p: string) => nodePath.basename(p),
            extname: (p: string) => nodePath.extname(p),
            resolve: (...parts: string[]) => nodePath.resolve(...parts)
        },

        JSON: {
            parse: JSON.parse,
            stringify: (obj: any, indent: number = 2) => JSON.stringify(obj, null, indent)
        },

        // Console (captured)
        console: {
            log: (...args: any[]) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            error: (...args: any[]) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
        },

        // Workspace info
        workspace: {
            root: workspaceRoot,
            name: nodePath.basename(workspaceRoot)
        },

        // Home directory (read-only access via fs.readHome)
        home: homeDir
    };
}

// ============================================================================
// Main Executor Class
// ============================================================================

export class UnifiedExecutor {
    private workspaceRoot: string;
    private browserManager: BrowserManager;
    private guardrails: SafetyGuardrails;
    private defaultTimeout: number;

    constructor(workspaceRoot: string, timeout: number = 300000) {
        this.workspaceRoot = workspaceRoot;
        this.browserManager = new BrowserManager();
        this.guardrails = new SafetyGuardrails(workspaceRoot);
        this.defaultTimeout = timeout;
    }

    /**
     * Create a checkpoint before making significant changes
     */
    createCheckpoint(description: string): string {
        return this.guardrails.createCheckpoint(description);
    }

    /**
     * Rollback to a previous checkpoint
     */
    rollback(checkpointId: string): boolean {
        return this.guardrails.rollback(checkpointId);
    }

    /**
     * Get safety status
     */
    getSafetyStatus() {
        return this.guardrails.getStatus();
    }

    /**
     * Execute code in the sandboxed context
     */
    async execute(code: string, timeout?: number): Promise<ExecutionResult> {
        const startTime = Date.now();
        const effectiveTimeout = timeout || this.defaultTimeout;

        try {
            const sandbox = createSandbox(this.workspaceRoot, this.browserManager, this.guardrails);

            // Wrap code to handle both sync and async, with explicit return
            const wrappedCode = `
                (async () => {
                    ${code}
                })()
            `;

            // Create VM context with safe globals
            const vmContext = vm.createContext({
                ...sandbox,
                setTimeout,
                setInterval,
                clearTimeout,
                clearInterval,
                Promise,
                Array,
                Object,
                String,
                Number,
                Boolean,
                Date,
                Math,
                RegExp,
                Error,
                Map,
                Set,
                // Explicitly NO: require, import, process, eval, Function
            });

            // Execute with timeout
            const script = new vm.Script(wrappedCode, { filename: 'execute.js' });
            const result = await script.runInContext(vmContext, {
                timeout: effectiveTimeout
            });

            return {
                success: true,
                result: result,
                duration: Date.now() - startTime
            };
        } catch (err: any) {
            return {
                success: false,
                error: err.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Cleanup resources (browser, etc.)
     */
    async dispose(): Promise<void> {
        await this.browserManager.close();
    }
}

// ============================================================================
// Tool Description (for System Prompt)
// ============================================================================

export function getUnifiedToolDescription(): string {
    return `## execute(code) - Run JavaScript with full system access

**Available APIs:**
\`\`\`
fs.read(path), fs.write(path, content), fs.writeForce(path, content), fs.restore(path)
fs.list(dir, {recursive}), fs.exists(path), fs.search(regex, dir), fs.delete(path)
fs.mkdir(path), fs.readHome(relativePath)

shell.run(cmd, {cwd, timeout}), shell.runAsync(cmd)

git.status(), git.diff(file?), git.log(n?), git.commit(msg), git.branch(), git.checkout(branch)

test.discover(dir?) - List tests without running (fast)
test.runFile(file) - Run single test file (2min timeout)
test.run(pattern?, {timeout}) - Run tests matching pattern (3min timeout)

fetch(url, options) - HTTP requests, returns JSON or text

browser.navigate(url), browser.click(selector), browser.type(selector, text)
browser.screenshot(path?), browser.getText(selector), browser.getElements(selector)
browser.waitFor(selector, timeout?), browser.close()

vscode.getProblems(), vscode.openFile(path, line?), vscode.getOpenFiles(), vscode.getSelection()

path.join(), path.dirname(), path.basename(), path.extname(), path.resolve()
JSON.parse(), JSON.stringify()
workspace.root, workspace.name, home
\`\`\`

**Safety Features (auto-enabled):**
- Syntax validation: fs.write() validates syntax before writing (Python, TypeScript, JS, JSON, YAML)
- Auto-backup: Files are backed up before modification. Use fs.restore(path) to revert
- Rate limiting: Max 20 writes/min, 5 deletes/min
- Protected files: .env, credentials, secrets require fs.writeForce()
- Command safety: Dangerous commands (rm -rf, DROP TABLE) are blocked

**SAFETY RULES:**
1. READ files before modifying them - understand the full context
2. Make minimal, focused changes - don't rewrite entire files for small fixes
3. Check for syntax errors AFTER edits: vscode.getProblems()
4. If you made a mistake, use fs.restore(path) to revert
5. NEVER use string.replace() blindly - understand what you're replacing

**Example:**
\`\`\`tool
{"name": "execute", "params": {"code": "return test.discover('backend/tests')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return test.runFile('backend/tests/test_api.py')"}}
\`\`\`

Use \`return\` for results. Scripts handle data - return only what's needed.`;
}

/**
 * Get safety rules for inclusion in agent system prompts
 */
export { getSafetyRulesForPrompt } from '../safety/guardrails';

// ============================================================================
// Tool Schema (for MCP compatibility)
// ============================================================================

export function getExecuteToolSchema() {
    return {
        name: 'execute',
        description: 'Run JavaScript code with full system access (fs, shell, git, browser, vscode)',
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'JavaScript code to execute. Use return for results.'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default 30000)'
                }
            },
            required: ['code']
        }
    };
}
