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
import * as fsPromises from 'fs/promises';
import * as nodePath from 'path';
import { execSync, spawn, spawnSync } from 'child_process';
import * as vm from 'vm';
import * as vscode from 'vscode';
import { SafetyGuardrails } from '../safety/guardrails';
import { 
    detectProjectInfo, 
    scaffoldProject, 
    ALL_TEMPLATES, 
    getAppDevPromptSection,
    DatabaseTools,
    DeploymentTools,
    EnvManager
} from '../tools/appDev';
import { GitHubClient } from '../tools/github';
import { CICDGenerator } from '../tools/cicd';

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
    // Editor stats for file operations
    linesAdded?: number;
    linesRemoved?: number;
    filePath?: string;
    // Browser automation
    screenshot?: string; // base64 encoded screenshot
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
    private idleTimeout: NodeJS.Timeout | null = null;
    private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    async ensureBrowser(): Promise<any> {
        // Reset idle timeout on each use
        this.resetIdleTimeout();
        
        if (!this.browser) {
            try {
                // Dynamic import to avoid requiring playwright if not used
                this.playwright = await import('playwright');
                this.browser = await this.playwright.chromium.launch({ 
                    headless: true,
                    timeout: 30000 // 30 second launch timeout
                });
                this.page = await this.browser.newPage();
                
                // Handle browser disconnect gracefully
                this.browser.on('disconnected', () => {
                    this.browser = null;
                    this.page = null;
                });
            } catch (err: any) {
                this.browser = null;
                this.page = null;
                throw new Error(`Browser init failed (install playwright): ${err.message}`);
            }
        }
        return this.page;
    }
    
    private resetIdleTimeout(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }
        this.idleTimeout = setTimeout(() => {
            this.close().catch(() => {}); // Auto-close after idle
        }, BrowserManager.IDLE_TIMEOUT_MS);
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
        // Clear idle timeout
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
        
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (_err) {
                // Browser may already be closed, ignore
            } finally {
                this.browser = null;
                this.page = null;
            }
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

        showDiff: (_original: string, _modified: string): void => {
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
// Execution Stats Tracker
// ============================================================================

interface FileStats {
    linesAdded: number;
    linesRemoved: number;
    filePath: string;
}

interface ExecutionStats {
    fileChanges: FileStats[];
    lastScreenshot: string | null;
}

function calculateLineDiff(original: string, modified: string): { added: number; removed: number } {
    const origLines = original ? original.split('\n') : [];
    const modLines = modified ? modified.split('\n') : [];

    // For a more accurate diff, we compare line by line
    const origSet = new Set(origLines);
    const modSet = new Set(modLines);
    
    let added = 0;
    let removed = 0;
    
    // Lines in modified but not in original = added
    for (const line of modLines) {
        if (!origSet.has(line)) added++;
    }
    
    // Lines in original but not in modified = removed
    for (const line of origLines) {
        if (!modSet.has(line)) removed++;
    }
    
    return { added, removed };
}

// ============================================================================
// Sandbox Factory
// ============================================================================

function createSandbox(workspaceRoot: string, browserManager: BrowserManager, guardrails: SafetyGuardrails, stats: ExecutionStats) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    return {
        // File System API (with security) - All async to prevent blocking extension host
        fs: {
            read: async (filePath: string): Promise<string> => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'read');
                    return await fsPromises.readFile(fullPath, 'utf-8');
                } catch (err: any) {
                    throw new Error(`Failed to read ${filePath}: ${err.message}`);
                }
            },

            write: async (filePath: string, content: string): Promise<string> => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'write');

                    // Safety check: Rate limiting and protected file check
                    const safetyCheck = await guardrails.checkFileOperation(filePath, 'write');
                    if (!safetyCheck.allowed) {
                        throw new Error(`Safety blocked: ${safetyCheck.reason}`);
                    }
                    if (safetyCheck.requiresConfirmation) {
                        throw new Error(`Protected file requires confirmation: ${filePath}. Use fs.writeForce() if you're sure.`);
                    }

                    // Read original content for diff calculation
                    let originalContent = '';
                    const exists = await fsPromises.access(fullPath).then(() => true).catch(() => false);
                    if (exists) {
                        originalContent = await fsPromises.readFile(fullPath, 'utf-8');
                        await guardrails.backupFile(fullPath);
                    }

                    // Validate syntax before writing
                    const validation = await guardrails.validateSyntax(filePath, content);
                    if (!validation.valid) {
                        throw new Error(`Syntax validation failed:\n${validation.errors.join('\n')}`);
                    }

                    // Analyze diff for potential issues
                    if (exists && originalContent) {
                        const issues = guardrails.analyzeDiff(originalContent, content);
                        if (issues.length > 0) {
                            console.warn(`[SafetyWarning] ${filePath}:\n${issues.join('\n')}`);
                        }
                    }

                    // Write file
                    await fsPromises.mkdir(nodePath.dirname(fullPath), { recursive: true });
                    await fsPromises.writeFile(fullPath, content, 'utf-8');

                    // Track line changes
                    const diff = calculateLineDiff(originalContent, content);
                    stats.fileChanges.push({
                        filePath: filePath,
                        linesAdded: diff.added,
                        linesRemoved: diff.removed
                    });

                    return `Written ${content.length} bytes to ${filePath} (+${diff.added}/-${diff.removed} lines)`;
                } catch (err: any) {
                    throw new Error(`Failed to write ${filePath}: ${err.message}`);
                }
            },

            // Force write (bypasses confirmation for protected files, but still validates syntax)
            writeForce: async (filePath: string, content: string): Promise<string> => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'write');

                    // Still validate syntax even for forced writes
                    const validation = await guardrails.validateSyntax(filePath, content);
                    if (!validation.valid) {
                        throw new Error(`Syntax validation failed:\n${validation.errors.join('\n')}`);
                    }

                    // Read original for diff
                    let originalContent = '';
                    const exists = await fsPromises.access(fullPath).then(() => true).catch(() => false);
                    if (exists) {
                        originalContent = await fsPromises.readFile(fullPath, 'utf-8');
                        await guardrails.backupFile(fullPath);
                    }

                    await fsPromises.mkdir(nodePath.dirname(fullPath), { recursive: true });
                    await fsPromises.writeFile(fullPath, content, 'utf-8');

                    // Track line changes
                    const diff = calculateLineDiff(originalContent, content);
                    stats.fileChanges.push({
                        filePath: filePath,
                        linesAdded: diff.added,
                        linesRemoved: diff.removed
                    });

                    return `[FORCE] Written ${content.length} bytes to ${filePath} (+${diff.added}/-${diff.removed} lines)`;
                } catch (err: any) {
                    throw new Error(`Failed to write ${filePath}: ${err.message}`);
                }
            },

            // Restore file from backup
            restore: async (filePath: string): Promise<string> => {
                if (await guardrails.restoreFile(filePath)) {
                    return `Restored ${filePath} from backup`;
                }
                throw new Error(`No backup found for ${filePath}`);
            },

            exists: async (filePath: string): Promise<boolean> => {
                try {
                    const fullPath = validatePath(filePath, workspaceRoot, 'read');
                    await fsPromises.access(fullPath);
                    return true;
                } catch {
                    return false;
                }
            },

            list: async (dirPath: string = '.', options?: { recursive?: boolean }): Promise<string[]> => {
                const fullPath = validatePath(dirPath, workspaceRoot, 'read');

                if (options?.recursive) {
                    const results: string[] = [];
                    const walk = async (dir: string, prefix: string = ''): Promise<void> => {
                        try {
                            const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                // Skip protected and hidden directories
                                if (entry.name.startsWith('.') || isProtectedPath(entry.name)) {
                                    continue;
                                }

                                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                                if (entry.isDirectory()) {
                                    await walk(nodePath.join(dir, entry.name), relPath);
                                } else {
                                    results.push(relPath);
                                }
                            }
                        } catch {}
                    };
                    await walk(fullPath);
                    return results;
                }

                const entries = await fsPromises.readdir(fullPath);
                return entries.filter(f => !isProtectedPath(f));
            },

            delete: async (filePath: string): Promise<string> => {
                const fullPath = validatePath(filePath, workspaceRoot, 'write');

                // Safety check: Rate limiting
                const safetyCheck = await guardrails.checkFileOperation(filePath, 'delete');
                if (!safetyCheck.allowed) {
                    throw new Error(`Safety blocked: ${safetyCheck.reason}`);
                }

                // Backup before delete
                const exists = await fsPromises.access(fullPath).then(() => true).catch(() => false);
                if (exists) {
                    await guardrails.backupFile(fullPath);
                }

                await fsPromises.unlink(fullPath);
                return `Deleted ${filePath}`;
            },

            mkdir: async (dirPath: string): Promise<void> => {
                const fullPath = validatePath(dirPath, workspaceRoot, 'write');
                await fsPromises.mkdir(fullPath, { recursive: true });
            },

            search: async (pattern: RegExp, dir: string = '.'): Promise<Array<{ file: string; line: number; match: string }>> => {
                const results: Array<{ file: string; line: number; match: string }> = [];
                const fullPath = validatePath(dir, workspaceRoot, 'read');

                const searchDir = async (currentDir: string, prefix: string = ''): Promise<void> => {
                    try {
                        const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.') || isProtectedPath(entry.name)) {
                                continue;
                            }

                            const entryPath = nodePath.join(currentDir, entry.name);
                            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

                            if (entry.isDirectory()) {
                                await searchDir(entryPath, relPath);
                            } else if (entry.isFile()) {
                                try {
                                    const content = await fsPromises.readFile(entryPath, 'utf-8');
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

                await searchDir(fullPath);
                return results;
            },

            readHome: async (relativePath: string): Promise<string> => {
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
                return await fsPromises.readFile(fullPath, 'utf-8');
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

                // SECURITY FIX: Parse command into args and use spawnSync without shell
                // This prevents command injection attacks
                const args = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
                if (args.length === 0) {
                    throw new Error('Empty command');
                }

                const program = args[0]!.replace(/^["']|["']$/g, ''); // Remove quotes from program (! safe: length checked)
                const programArgs = args.slice(1).map(arg => arg.replace(/^["']|["']$/g, '')); // Remove quotes from args

                try {
                    const result = spawnSync(program, programArgs, {
                        cwd,
                        timeout: options?.timeout || 120000,
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        maxBuffer: 10 * 1024 * 1024, // 10MB
                        shell: false  // CRITICAL: Prevents command injection
                    });

                    if (result.error) {
                        throw result.error;
                    }

                    // Combine stdout and stderr
                    const output = (result.stdout || '') + (result.stderr || '');

                    if (result.status !== 0 && result.status !== null) {
                        return `[EXIT CODE: ${result.status}]\n${output}`;
                    }

                    return output;
                } catch (err: any) {
                    throw new Error(`Command failed: ${err.message}`);
                }
            },

            runAsync: (command: string): Promise<string> => {
                // Safety check: Block dangerous commands (same as sync version)
                const cmdCheck = guardrails.checkCommand(command);
                if (!cmdCheck.allowed) {
                    return Promise.reject(new Error(`Dangerous command blocked: ${cmdCheck.reason}`));
                }

                // SECURITY FIX: Parse command into args and use spawn without shell
                const args = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
                if (args.length === 0) {
                    return Promise.reject(new Error('Empty command'));
                }

                const program = args[0]!.replace(/^["']|["']$/g, ''); // ! safe: length checked
                const programArgs = args.slice(1).map(arg => arg.replace(/^["']|["']$/g, ''));

                return new Promise((resolve, reject) => {
                    const proc = spawn(program, programArgs, {
                        cwd: workspaceRoot,
                        shell: false  // CRITICAL: Prevents command injection
                    });
                    let output = '';
                    proc.stdout?.on('data', d => output += d);
                    proc.stderr?.on('data', d => output += d);
                    proc.on('close', () => resolve(output));
                    proc.on('error', (err) => reject(new Error(`Command failed: ${err.message}`)));
                });
            }
        },

        // Git API
        git: {
            status: (): string => {
                try {
                    const result = spawnSync('git', ['status', '--short'], {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return result.stdout || result.stderr || '';
                } catch (err: any) {
                    return err.message;
                }
            },

            diff: (file?: string): string => {
                try {
                    // SECURITY FIX: Use spawn args array to prevent injection in file parameter
                    const args = file ? ['diff', '--', file] : ['diff'];
                    const result = spawnSync('git', args, {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return result.stdout || result.stderr || '';
                } catch (err: any) {
                    return err.message;
                }
            },

            log: (n: number = 5): string => {
                try {
                    const result = spawnSync('git', ['log', `-${n}`, '--oneline'], {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return result.stdout || result.stderr || '';
                } catch (err: any) {
                    return err.message;
                }
            },

            commit: (message: string): string => {
                try {
                    // SECURITY FIX: Use spawn args array to prevent injection in commit message
                    spawnSync('git', ['add', '-A'], {
                        cwd: workspaceRoot,
                        shell: false
                    });

                    const result = spawnSync('git', ['commit', '-m', message], {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return result.stdout || result.stderr || '';
                } catch (err: any) {
                    return err.message;
                }
            },

            branch: (): string => {
                try {
                    const result = spawnSync('git', ['branch', '--show-current'], {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return (result.stdout || '').trim();
                } catch (err: any) {
                    return err.message;
                }
            },

            checkout: (branch: string): string => {
                try {
                    // SECURITY FIX: Use spawn args array to prevent injection in branch parameter
                    const result = spawnSync('git', ['checkout', branch], {
                        cwd: workspaceRoot,
                        encoding: 'utf-8',
                        shell: false
                    });
                    return result.stdout || result.stderr || '';
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

        // Browser API (lazy initialized) - tracks screenshots
        // Auto-captures screenshot after navigate/click for live preview
        browser: {
            navigate: async (url: string) => {
                await browserManager.navigate(url);
                // Auto-capture for live preview
                try {
                    const screenshot = await browserManager.screenshot();
                    stats.lastScreenshot = screenshot;
                } catch { /* ignore screenshot failures */ }
            },
            click: async (selector: string) => {
                await browserManager.click(selector);
                // Auto-capture after click for live preview
                try {
                    const screenshot = await browserManager.screenshot();
                    stats.lastScreenshot = screenshot;
                } catch { /* ignore screenshot failures */ }
            },
            type: (selector: string, text: string) => browserManager.type(selector, text),
            screenshot: async (path?: string) => {
                const result = await browserManager.screenshot(path);
                // If no path provided, result is base64 - save to stats
                if (!path && result) {
                    stats.lastScreenshot = result;
                }
                return result;
            },
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

        // App Development Tools
        project: {
            // Detect project info (framework, package manager, etc.)
            detect: async () => await detectProjectInfo(workspaceRoot),
            
            // Create new project from template
            scaffold: async (template: string, name: string) => 
                await scaffoldProject(workspaceRoot, template, name),
            
            // List available templates
            templates: () => Object.entries(ALL_TEMPLATES).map(([key, t]) => ({
                id: key,
                name: t.name,
                description: t.description,
                framework: t.framework
            })),

            // Get framework-specific guidance
            guide: async () => {
                const info = await detectProjectInfo(workspaceRoot);
                return getAppDevPromptSection(info);
            }
        },

        // Database Tools (Prisma, SQL)
        db: (() => {
            const dbTools = new DatabaseTools(workspaceRoot);
            return {
                detect: () => dbTools.detectDatabase(),
                prisma: (cmd: 'generate' | 'push' | 'migrate' | 'studio' | 'seed', args?: string) => 
                    dbTools.prisma(cmd, args),
                migrate: (name: string) => dbTools.createMigration(name),
                generate: () => dbTools.generateClient(),
                studio: () => dbTools.openStudio(),
                query: (sql: string) => dbTools.query(sql)
            };
        })(),

        // Deployment Tools (Docker, Vercel)
        deploy: (() => {
            const deployTools = new DeploymentTools(workspaceRoot);
            return {
                dockerfile: (type: 'node' | 'python' | 'next' = 'node') => 
                    deployTools.generateDockerfile(type),
                compose: (options?: { services?: ('app' | 'postgres' | 'redis')[]; appPort?: number }) => 
                    deployTools.generateDockerCompose(options),
                vercelConfig: () => deployTools.generateVercelConfig(),
                vercel: (production: boolean = false) => deployTools.deployVercel(production),
                dockerBuild: (tag: string = 'app:latest') => deployTools.buildDocker(tag),
                dockerRun: (tag: string = 'app:latest', port: number = 3000) => 
                    deployTools.runDocker(tag, port),
                composeUp: (detached: boolean = true) => deployTools.composeUp(detached),
                composeDown: () => deployTools.composeDown()
            };
        })(),

        // Environment Management
        env: (() => {
            const envManager = new EnvManager(workspaceRoot);
            return {
                template: () => envManager.listEnvTemplate(),
                missing: () => envManager.checkMissingEnv(),
                create: () => envManager.createEnvFromExample(),
                set: (key: string, value: string) => envManager.setEnvVar(key, value),
                generateExample: () => envManager.generateEnvExample()
            };
        })(),

        // GitHub Integration
        github: (() => {
            const client = new GitHubClient({});
            return {
                // Setup
                setToken: (token: string) => { 
                    (client as any).token = token;
                    return 'Token set';
                },
                setRepo: (owner: string, repo: string) => {
                    client.setRepo(owner, repo);
                    return `Set repo to ${owner}/${repo}`;
                },
                
                // Repository
                getRepo: (owner?: string, repo?: string) => client.getRepo(owner, repo),
                listRepos: (username?: string) => client.listRepos(username),
                createRepo: (name: string, options?: { description?: string; private?: boolean }) => 
                    client.createRepo(name, options),
                
                // Issues
                listIssues: (state?: 'open' | 'closed' | 'all') => client.listIssues(state),
                getIssue: (number: number) => client.getIssue(number),
                createIssue: (title: string, body?: string, labels?: string[]) => 
                    client.createIssue(title, body, labels),
                updateIssue: (number: number, updates: { title?: string; body?: string; state?: 'open' | 'closed' }) =>
                    client.updateIssue(number, updates),
                addComment: (issueNumber: number, body: string) => client.addComment(issueNumber, body),
                
                // Pull Requests
                listPRs: (state?: 'open' | 'closed' | 'all') => client.listPullRequests(state),
                createPR: (title: string, head: string, base: string, body?: string) =>
                    client.createPullRequest(title, head, base, body),
                mergePR: (number: number, method?: 'merge' | 'squash' | 'rebase') =>
                    client.mergePullRequest(number, method),
                
                // Branches
                listBranches: () => client.listBranches(),
                createBranch: (name: string, from?: string) => client.createBranch(name, from),
                deleteBranch: (name: string) => client.deleteBranch(name),
                
                // Actions
                listWorkflows: () => client.listWorkflows(),
                listRuns: (workflowId?: number) => client.listWorkflowRuns(workflowId),
                triggerWorkflow: (workflowId: number | string, ref: string, inputs?: Record<string, string>) =>
                    client.triggerWorkflow(workflowId, ref, inputs),
                
                // Releases
                listReleases: () => client.listReleases(),
                createRelease: (tagName: string, options?: { name?: string; body?: string; draft?: boolean; prerelease?: boolean }) =>
                    client.createRelease(tagName, options),
                
                // Files
                getFile: (path: string, ref?: string) => client.getFileContent(path, ref),
                updateFile: (path: string, content: string, message: string, branch?: string) =>
                    client.createOrUpdateFile(path, content, message, branch),
                
                // Search
                searchCode: (query: string) => client.searchCode(query),
                searchIssues: (query: string) => client.searchIssues(query)
            };
        })(),

        // CI/CD Workflow Generation
        cicd: (() => {
            const generator = new CICDGenerator(workspaceRoot);
            return {
                generateCI: async (options?: { runTests?: boolean; runLint?: boolean; runBuild?: boolean }) => {
                    const projectInfo = await detectProjectInfo(workspaceRoot);
                    return generator.generateCI(projectInfo, options);
                },
                generateVercelDeploy: (branches?: string[]) => generator.generateVercelDeploy(branches),
                generateDockerDeploy: (imageName: string, registry?: 'ghcr' | 'dockerhub') =>
                    generator.generateDockerDeploy(imageName, registry),
                generateRelease: () => generator.generateRelease(),
                generateDependabot: () => generator.generateDependabot(),
                generateGitLabCI: async (options?: { runTests?: boolean; runLint?: boolean; runBuild?: boolean }) => {
                    const projectInfo = await detectProjectInfo(workspaceRoot);
                    return generator.generateGitLabCI(projectInfo, options);
                },
                generateAll: async () => {
                    const projectInfo = await detectProjectInfo(workspaceRoot);
                    return generator.generateAll(projectInfo);
                }
            };
        })(),

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
    async createCheckpoint(description: string): Promise<string> {
        return this.guardrails.createCheckpoint(description);
    }

    /**
     * Rollback to a previous checkpoint
     */
    async rollback(checkpointId: string): Promise<boolean> {
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
        // SECURITY: VM sandbox disabled due to CRITICAL vulnerability (CVE-pending)
        // The vm.runInContext() implementation is vulnerable to constructor escape attacks
        // that allow arbitrary code execution, bypassing all sandboxing.
        //
        // Attack vector: constructor.constructor('malicious code')()
        // This allows malicious prompts to execute any Node.js code with full file system access.
        //
        // ALTERNATIVE: Use shell.run() for safe command execution instead.
        // Agents have access to all necessary tools without needing JavaScript execution.
        //
        // TODO: Implement secure alternative using isolated V8 contexts or WebAssembly sandbox

        throw new Error(
            'Code execution disabled due to security vulnerability. ' +
            'VM sandbox is bypassable via constructor escape attacks. ' +
            'Use shell.run() for command execution instead.'
        );
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
# File System
fs.read(path), fs.write(path, content), fs.writeForce(path, content), fs.restore(path)
fs.list(dir, {recursive}), fs.exists(path), fs.search(regex, dir), fs.delete(path)
fs.mkdir(path), fs.readHome(relativePath)

# Shell & Git (local)
shell.run(cmd, {cwd, timeout}), shell.runAsync(cmd)
git.status(), git.diff(file?), git.log(n?), git.commit(msg), git.branch(), git.checkout(branch)

# Testing
test.discover(dir?), test.runFile(file), test.run(pattern?, {timeout})

# HTTP & Browser
fetch(url, options)
browser.navigate(url), browser.click(selector), browser.type(selector, text)
browser.screenshot(path?), browser.getText(selector), browser.getElements(selector)

# VS Code Integration
vscode.getProblems(), vscode.openFile(path, line?), vscode.getOpenFiles()

# Project Management
project.detect(), project.templates(), project.scaffold(template, name), project.guide()

# Database (Prisma)
db.detect(), db.prisma(cmd, args?), db.migrate(name), db.generate(), db.studio(), db.query(sql)

# Deployment
deploy.dockerfile(type?), deploy.compose(options?), deploy.vercelConfig()
deploy.vercel(production?), deploy.dockerBuild(tag?), deploy.composeUp(), deploy.composeDown()

# Environment
env.template(), env.missing(), env.create(), env.set(key, value), env.generateExample()

# GitHub API (requires token)
github.setToken(token), github.setRepo(owner, repo)
github.getRepo(), github.listRepos(), github.createRepo(name, options?)
github.listIssues(state?), github.getIssue(number), github.createIssue(title, body?, labels?)
github.updateIssue(number, updates), github.addComment(issueNumber, body)
github.listPRs(state?), github.createPR(title, head, base, body?), github.mergePR(number, method?)
github.listBranches(), github.createBranch(name, from?), github.deleteBranch(name)
github.listWorkflows(), github.listRuns(workflowId?), github.triggerWorkflow(id, ref, inputs?)
github.listReleases(), github.createRelease(tagName, options?)
github.getFile(path, ref?), github.updateFile(path, content, message, branch?)
github.searchCode(query), github.searchIssues(query)

# CI/CD Generation
cicd.generateCI(options?) - GitHub Actions CI workflow
cicd.generateVercelDeploy(branches?) - Vercel deployment workflow
cicd.generateDockerDeploy(imageName, registry?) - Docker build & push workflow
cicd.generateRelease() - Release workflow with changelog
cicd.generateDependabot() - Dependabot config
cicd.generateGitLabCI(options?) - GitLab CI config
cicd.generateAll() - Generate all common CI/CD files

# Utilities
path.join(), path.dirname(), path.basename(), path.extname(), path.resolve()
JSON.parse(), JSON.stringify()
workspace.root, workspace.name, home
\`\`\`

**Templates:** react-ts, next-ts, vue-ts, svelte-ts, express-ts, fastapi, flask, fullstack-next

**GitHub Setup:**
\`\`\`javascript
github.setToken(process.env.GITHUB_TOKEN || 'ghp_...')
github.setRepo('owner', 'repo')
return github.listIssues('open')
\`\`\`

**CI/CD Quick Setup:**
\`\`\`javascript
return cicd.generateAll() // Creates ci.yml, dependabot.yml, release.yml
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
