/**
 * Local MCP Server
 * Exposes all local sandbox APIs as MCP-compatible tools
 * This allows unified tool execution through the MCP protocol
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { SafetyGuardrails } from '../safety/guardrails';
import { IEventBus } from '../core/interfaces/IEventBus';

export interface McpTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface McpToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

export interface LocalServerConfig {
    workspaceRoot: string;
    guardrails?: SafetyGuardrails;
    eventBus?: IEventBus;
}

/**
 * Protected paths that should not be accessed
 */
const PROTECTED_PATHS = new Set([
    'node_modules', '.git', '.env', '.env.local', '.env.production',
    '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache',
    'dist', 'build', '.next', '.nuxt', '.output',
    'credentials', 'secrets', '.ssh', '.gnupg'
]);

/**
 * Validate and resolve file path
 */
function validatePath(filePath: string, workspaceRoot: string, operation: 'read' | 'write'): string {
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceRoot, filePath);

    // Check path doesn't escape workspace for write operations
    if (operation === 'write' && !fullPath.startsWith(workspaceRoot)) {
        throw new Error('Cannot write outside workspace');
    }

    // Check for protected paths
    const parts = filePath.split(/[/\\]/);
    for (const part of parts) {
        if (PROTECTED_PATHS.has(part)) {
            throw new Error(`Access denied: protected path '${part}'`);
        }
    }

    return fullPath;
}

/**
 * Local MCP Server - Exposes sandbox APIs as MCP tools
 */
export class LocalMcpServer {
    private workspaceRoot: string;
    private guardrails: SafetyGuardrails | null;
    private eventBus?: IEventBus;
    private tools: Map<string, {
        definition: McpTool;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
    }> = new Map();

    constructor(config: LocalServerConfig) {
        this.workspaceRoot = config.workspaceRoot;
        this.guardrails = config.guardrails ?? null;
        this.eventBus = config.eventBus;

        this.registerAllTools();
    }

    /**
     * Register all local tools
     */
    private registerAllTools(): void {
        this.registerFileSystemTools();
        this.registerShellTools();
        this.registerGitTools();
        this.registerTestTools();
        this.registerPathTools();
        this.registerWorkspaceTools();
    }

    /**
     * Register a tool
     */
    private register(
        name: string,
        description: string,
        inputSchema: McpTool['inputSchema'],
        handler: (args: Record<string, unknown>) => Promise<unknown>
    ): void {
        this.tools.set(name, {
            definition: { name, description, inputSchema },
            handler,
        });
    }

    /**
     * File System Tools
     */
    private registerFileSystemTools(): void {
        // fs.read
        this.register(
            'local_fs_read',
            'Read a file from the workspace',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace' },
                },
                required: ['path'],
            },
            async (args) => {
                const filePath = args.path as string;
                const fullPath = validatePath(filePath, this.workspaceRoot, 'read');
                return await fsPromises.readFile(fullPath, 'utf-8');
            }
        );

        // fs.write
        this.register(
            'local_fs_write',
            'Write content to a file in the workspace',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace' },
                    content: { type: 'string', description: 'Content to write' },
                },
                required: ['path', 'content'],
            },
            async (args) => {
                const filePath = args.path as string;
                const content = args.content as string;
                const fullPath = validatePath(filePath, this.workspaceRoot, 'write');

                // Safety check
                if (this.guardrails) {
                    const check = await this.guardrails.checkFileOperation(filePath, 'write');
                    if (!check.allowed) {
                        throw new Error(`Safety blocked: ${check.reason}`);
                    }
                }

                // Ensure directory exists
                await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
                await fsPromises.writeFile(fullPath, content, 'utf-8');

                return `Written ${content.length} bytes to ${filePath}`;
            }
        );

        // fs.exists
        this.register(
            'local_fs_exists',
            'Check if a file or directory exists',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to check' },
                },
                required: ['path'],
            },
            async (args) => {
                const filePath = args.path as string;
                const fullPath = validatePath(filePath, this.workspaceRoot, 'read');
                try {
                    await fsPromises.access(fullPath);
                    return true;
                } catch {
                    return false;
                }
            }
        );

        // fs.list
        this.register(
            'local_fs_list',
            'List files in a directory',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (default: .)' },
                    recursive: { type: 'boolean', description: 'Recurse into subdirectories' },
                },
            },
            async (args) => {
                const dirPath = (args.path as string) || '.';
                const recursive = args.recursive as boolean;
                const fullPath = validatePath(dirPath, this.workspaceRoot, 'read');

                if (recursive) {
                    const results: string[] = [];
                    const walk = async (dir: string, prefix = ''): Promise<void> => {
                        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.') || PROTECTED_PATHS.has(entry.name)) continue;
                            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                            if (entry.isDirectory()) {
                                await walk(path.join(dir, entry.name), relPath);
                            } else {
                                results.push(relPath);
                            }
                        }
                    };
                    await walk(fullPath);
                    return results;
                }

                const entries = await fsPromises.readdir(fullPath);
                return entries.filter(f => !PROTECTED_PATHS.has(f));
            }
        );

        // fs.delete
        this.register(
            'local_fs_delete',
            'Delete a file from the workspace',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to delete' },
                },
                required: ['path'],
            },
            async (args) => {
                const filePath = args.path as string;
                const fullPath = validatePath(filePath, this.workspaceRoot, 'write');

                if (this.guardrails) {
                    const check = await this.guardrails.checkFileOperation(filePath, 'delete');
                    if (!check.allowed) {
                        throw new Error(`Safety blocked: ${check.reason}`);
                    }
                }

                await fsPromises.unlink(fullPath);
                return `Deleted ${filePath}`;
            }
        );

        // fs.mkdir
        this.register(
            'local_fs_mkdir',
            'Create a directory',
            {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to create' },
                },
                required: ['path'],
            },
            async (args) => {
                const dirPath = args.path as string;
                const fullPath = validatePath(dirPath, this.workspaceRoot, 'write');
                await fsPromises.mkdir(fullPath, { recursive: true });
                return `Created directory ${dirPath}`;
            }
        );

        // fs.search
        this.register(
            'local_fs_search',
            'Search for a pattern in files',
            {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Regex pattern to search for' },
                    directory: { type: 'string', description: 'Directory to search in (default: .)' },
                },
                required: ['pattern'],
            },
            async (args) => {
                const pattern = new RegExp(args.pattern as string);
                const dir = (args.directory as string) || '.';
                const fullPath = validatePath(dir, this.workspaceRoot, 'read');

                const results: Array<{ file: string; line: number; match: string }> = [];

                const searchDir = async (currentDir: string, prefix = ''): Promise<void> => {
                    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.name.startsWith('.') || PROTECTED_PATHS.has(entry.name)) continue;

                        const entryPath = path.join(currentDir, entry.name);
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
                                            match: line.trim().substring(0, 200),
                                        });
                                    }
                                });
                            } catch { /* ignore unreadable files */ }
                        }
                    }
                };

                await searchDir(fullPath);
                return results;
            }
        );
    }

    /**
     * Shell Tools
     */
    private registerShellTools(): void {
        // shell.run
        this.register(
            'local_shell_run',
            'Run a shell command synchronously',
            {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to execute' },
                    cwd: { type: 'string', description: 'Working directory (default: workspace root)' },
                    timeout: { type: 'number', description: 'Timeout in ms (default: 120000)' },
                },
                required: ['command'],
            },
            async (args) => {
                const command = args.command as string;
                const cwd = args.cwd
                    ? validatePath(args.cwd as string, this.workspaceRoot, 'read')
                    : this.workspaceRoot;
                const timeout = (args.timeout as number) || 120000;

                if (this.guardrails) {
                    const check = this.guardrails.checkCommand(command);
                    if (!check.allowed) {
                        throw new Error(`Command blocked: ${check.reason}`);
                    }
                }

                try {
                    return execSync(command, {
                        cwd,
                        timeout,
                        encoding: 'utf-8',
                        maxBuffer: 10 * 1024 * 1024,
                    });
                } catch (err: unknown) {
                    const error = err as { stdout?: Buffer; stderr?: Buffer; status?: number; message?: string };
                    const stdout = error.stdout?.toString() || '';
                    const stderr = error.stderr?.toString() || '';
                    return `[EXIT CODE: ${error.status ?? 'unknown'}]\n${stdout}\n${stderr}`.trim() || error.message;
                }
            }
        );

        // shell.runAsync
        this.register(
            'local_shell_run_async',
            'Run a shell command asynchronously',
            {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to execute' },
                },
                required: ['command'],
            },
            async (args) => {
                const command = args.command as string;

                if (this.guardrails) {
                    const check = this.guardrails.checkCommand(command);
                    if (!check.allowed) {
                        throw new Error(`Command blocked: ${check.reason}`);
                    }
                }

                return new Promise<string>((resolve) => {
                    const proc = spawn(command, { shell: true, cwd: this.workspaceRoot });
                    let output = '';
                    proc.stdout?.on('data', d => output += d);
                    proc.stderr?.on('data', d => output += d);
                    proc.on('close', () => resolve(output));
                    proc.on('error', (err) => resolve(`Error: ${err.message}`));
                });
            }
        );
    }

    /**
     * Git Tools
     */
    private registerGitTools(): void {
        const runGit = (cmd: string): string => {
            try {
                return execSync(cmd, { cwd: this.workspaceRoot, encoding: 'utf-8' });
            } catch (err: unknown) {
                const error = err as { message?: string };
                return error.message || 'Git command failed';
            }
        };

        this.register(
            'local_git_status',
            'Get git status',
            { type: 'object', properties: {} },
            async () => runGit('git status --short')
        );

        this.register(
            'local_git_diff',
            'Get git diff',
            {
                type: 'object',
                properties: {
                    file: { type: 'string', description: 'Optional file to diff' },
                },
            },
            async (args) => {
                const file = args.file as string;
                return runGit(file ? `git diff -- "${file}"` : 'git diff');
            }
        );

        this.register(
            'local_git_log',
            'Get git log',
            {
                type: 'object',
                properties: {
                    count: { type: 'number', description: 'Number of commits (default: 5)' },
                },
            },
            async (args) => {
                const n = (args.count as number) || 5;
                return runGit(`git log -${n} --oneline`);
            }
        );

        this.register(
            'local_git_commit',
            'Stage all and commit',
            {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Commit message' },
                },
                required: ['message'],
            },
            async (args) => {
                const message = (args.message as string).replace(/"/g, '\\"');
                runGit('git add -A');
                return runGit(`git commit -m "${message}"`);
            }
        );

        this.register(
            'local_git_branch',
            'Get current branch name',
            { type: 'object', properties: {} },
            async () => runGit('git branch --show-current').trim()
        );

        this.register(
            'local_git_checkout',
            'Checkout a branch',
            {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'Branch name' },
                },
                required: ['branch'],
            },
            async (args) => runGit(`git checkout ${args.branch}`)
        );
    }

    /**
     * Test Tools
     */
    private registerTestTools(): void {
        this.register(
            'local_test_discover',
            'Discover available tests',
            {
                type: 'object',
                properties: {
                    directory: { type: 'string', description: 'Directory to search (default: .)' },
                },
            },
            async (args) => {
                const dir = (args.directory as string) || '.';
                const fullPath = validatePath(dir, this.workspaceRoot, 'read');

                try {
                    return execSync('python -m pytest --collect-only -q', {
                        cwd: fullPath,
                        encoding: 'utf-8',
                        timeout: 30000,
                    });
                } catch {
                    try {
                        return execSync('npx vitest list 2>&1', {
                            cwd: fullPath,
                            encoding: 'utf-8',
                            timeout: 30000,
                        });
                    } catch {
                        return 'Could not discover tests';
                    }
                }
            }
        );

        this.register(
            'local_test_run',
            'Run tests',
            {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Test pattern to match' },
                    timeout: { type: 'number', description: 'Timeout in ms (default: 180000)' },
                },
            },
            async (args) => {
                const pattern = args.pattern as string;
                const timeout = (args.timeout as number) || 180000;

                // Detect test framework
                const hasPytest = fs.existsSync(path.join(this.workspaceRoot, 'pytest.ini')) ||
                    fs.existsSync(path.join(this.workspaceRoot, 'pyproject.toml'));
                const hasVitest = fs.existsSync(path.join(this.workspaceRoot, 'vitest.config.ts')) ||
                    fs.existsSync(path.join(this.workspaceRoot, 'vitest.config.js'));

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
                    cmd = pattern ? `npm test -- "${pattern}"` : 'npm test';
                }

                try {
                    return execSync(cmd, {
                        cwd: this.workspaceRoot,
                        encoding: 'utf-8',
                        timeout,
                        maxBuffer: 10 * 1024 * 1024,
                    });
                } catch (err: unknown) {
                    const error = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
                    return `[EXIT CODE: ${error.status}]\n${error.stdout?.toString() || ''}\n${error.stderr?.toString() || ''}`;
                }
            }
        );

        this.register(
            'local_test_run_file',
            'Run a single test file',
            {
                type: 'object',
                properties: {
                    file: { type: 'string', description: 'Test file path' },
                },
                required: ['file'],
            },
            async (args) => {
                const testFile = args.file as string;
                const fullPath = validatePath(testFile, this.workspaceRoot, 'read');

                try {
                    if (testFile.endsWith('.py')) {
                        return execSync(`python -m pytest "${fullPath}" -v --tb=short`, {
                            cwd: this.workspaceRoot,
                            encoding: 'utf-8',
                            timeout: 120000,
                        });
                    } else {
                        return execSync(`npx vitest run "${testFile}" --reporter=verbose`, {
                            cwd: this.workspaceRoot,
                            encoding: 'utf-8',
                            timeout: 120000,
                        });
                    }
                } catch (err: unknown) {
                    const error = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
                    return `[EXIT CODE: ${error.status}]\n${error.stdout?.toString() || ''}\n${error.stderr?.toString() || ''}`;
                }
            }
        );
    }

    /**
     * Path Tools
     */
    private registerPathTools(): void {
        this.register(
            'local_path_join',
            'Join path segments',
            {
                type: 'object',
                properties: {
                    parts: { type: 'array', items: { type: 'string' }, description: 'Path segments' },
                },
                required: ['parts'],
            },
            async (args) => path.join(...(args.parts as string[]))
        );

        this.register(
            'local_path_dirname',
            'Get directory name of a path',
            {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
            },
            async (args) => path.dirname(args.path as string)
        );

        this.register(
            'local_path_basename',
            'Get base name of a path',
            {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
            },
            async (args) => path.basename(args.path as string)
        );

        this.register(
            'local_path_extname',
            'Get extension of a path',
            {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
            },
            async (args) => path.extname(args.path as string)
        );
    }

    /**
     * Workspace Tools
     */
    private registerWorkspaceTools(): void {
        this.register(
            'local_workspace_info',
            'Get workspace information',
            { type: 'object', properties: {} },
            async () => ({
                root: this.workspaceRoot,
                name: path.basename(this.workspaceRoot),
            })
        );
    }

    /**
     * List all available tools
     */
    async listTools(): Promise<McpTool[]> {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    /**
     * Call a tool
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }

        try {
            const startTime = Date.now();
            const result = await tool.handler(args);
            const duration = Date.now() - startTime;

            // Emit event
            if (this.eventBus) {
                this.eventBus.emit('tool:completed', {
                    name,
                    args,
                    duration,
                    success: true,
                });
            }

            // Format result
            const text = typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2);

            return {
                content: [{ type: 'text', text }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (this.eventBus) {
                this.eventBus.emit('tool:failed', {
                    name,
                    args,
                    error: errorMessage,
                });
            }

            return {
                content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }

    /**
     * Check if a tool exists
     */
    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Update workspace root
     */
    setWorkspaceRoot(workspaceRoot: string): void {
        this.workspaceRoot = workspaceRoot;
    }
}
