// Core tools for autonomous agents
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { validatePath } from '../utils/pathValidator';

const execAsync = promisify(exec);

// Async file existence check
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Inline security helpers
function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(filePath);
    const workspace = path.resolve(workspaceRoot);
    return resolved.startsWith(workspace);
}

function canRead(filePath: string, _workspaceRoot: string): { allowed: boolean; reason?: string } {
    const blocked = ['.env', '.env.local', 'credentials', 'secrets', '.git/config'];
    const filename = path.basename(filePath).toLowerCase();
    if (blocked.some(b => filename.includes(b))) {
        return { allowed: false, reason: 'Sensitive file - read not allowed' };
    }
    return { allowed: true };
}

function canWrite(filePath: string, _workspaceRoot: string): { allowed: boolean; reason?: string } {
    const blocked = ['.env', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    const filename = path.basename(filePath).toLowerCase();
    if (blocked.some(b => filename === b)) {
        return { allowed: false, reason: 'Protected file - write not allowed' };
    }
    return { allowed: true };
}

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
    execute: (params: Record<string, any>, workspaceRoot: string) => Promise<ToolResult>;
}

/**
 * Parse test output and return a structured result
 */
function parseTestOutput(output: string, exitCode: number, command?: string): ToolResult {
    const success = exitCode === 0;
    const trimmedOutput = (output || '').trim();
    
    if (!trimmedOutput) {
        return {
            success: false,
            output: `[No test output captured]\nCommand: ${command || 'unknown'}\nExit code: ${exitCode}\n\nTroubleshooting:\n- For pytest: use "python -m pytest -v --tb=short"\n- For vitest: use "npx vitest run --reporter=verbose"\n- Check if tests exist in the specified path`,
            error: `Tests completed with exit code ${exitCode} but no output was captured`
        };
    }
    
    return {
        success,
        output: trimmedOutput,
        error: success ? undefined : `Tests failed with exit code ${exitCode}`
    };
}

export const TOOLS: Record<string, Tool> = {
    read_file: {
        name: 'read_file',
        description: 'Read contents of a file. Some files are protected for security.',
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace', required: true },
            lines: { type: 'string', description: 'Line range like "1-50" or "100-150" (optional)' }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path) {
                    return { success: false, output: '', error: 'Missing required parameter: path' };
                }
                const filePath = path.resolve(workspaceRoot, params.path);

                validatePath(filePath, workspaceRoot);

                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const readCheck = canRead(filePath, workspaceRoot);
                if (!readCheck.allowed) {
                    return { success: false, output: '', error: readCheck.reason };
                }

                let content = await fsPromises.readFile(filePath, 'utf-8');
                
                if (params.lines) {
                    const [start, end] = params.lines.split('-').map(Number);
                    const lines = content.split('\n');
                    content = lines.slice(start - 1, end).join('\n');
                    return { success: true, output: `Lines ${start}-${end}:\n${content}` };
                }
                
                if (content.length > 10000) {
                    content = content.substring(0, 10000) + '\n... (truncated, use lines parameter for specific sections)';
                }
                
                return { success: true, output: content };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    write_file: {
        name: 'write_file',
        description: 'Write content to a file. WARNING: This OVERWRITES the entire file! For editing existing files, use patch_file instead. Only use write_file for creating NEW files.',
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace', required: true },
            content: { type: 'string', description: 'COMPLETE file content (overwrites everything!)', required: true }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path) {
                    return { success: false, output: '', error: 'Missing required parameter: path' };
                }
                if (!params.content && params.content !== '') {
                    return { success: false, output: '', error: 'Missing required parameter: content' };
                }
                const filePath = path.resolve(workspaceRoot, params.path);

                validatePath(filePath, workspaceRoot);

                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const writeCheck = canWrite(filePath, workspaceRoot);
                if (!writeCheck.allowed) {
                    return { success: false, output: '', error: writeCheck.reason };
                }

                const dir = path.dirname(filePath);
                if (!await fileExists(dir)) {
                    validatePath(dir, workspaceRoot);
                    await fsPromises.mkdir(dir, { recursive: true });
                }

                await fsPromises.writeFile(filePath, params.content, 'utf-8');
                return { success: true, output: `Written to ${params.path}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    patch_file: {
        name: 'patch_file',
        description: 'Apply a patch to modify specific parts of a file. Use this instead of write_file when editing existing files.',
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace', required: true },
            search: { type: 'string', description: 'Exact text to find', required: true },
            replace: { type: 'string', description: 'Text to replace with', required: true }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path || params.search === undefined || params.replace === undefined) {
                    return { success: false, output: '', error: 'Missing required parameters' };
                }
                const filePath = path.resolve(workspaceRoot, params.path);

                validatePath(filePath, workspaceRoot);

                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const writeCheck = canWrite(filePath, workspaceRoot);
                if (!writeCheck.allowed) {
                    return { success: false, output: '', error: writeCheck.reason };
                }

                const content = await fsPromises.readFile(filePath, 'utf-8');
                
                if (!content.includes(params.search)) {
                    return { success: false, output: '', error: `Search string not found in file. Make sure you're using the exact text.` };
                }
                
                const newContent = content.replace(params.search, params.replace);
                await fsPromises.writeFile(filePath, newContent, 'utf-8');
                
                return { success: true, output: `Patched ${params.path}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    list_directory: {
        name: 'list_directory',
        description: 'List files and directories in a path',
        parameters: {
            path: { type: 'string', description: 'Directory path relative to workspace', required: true },
            recursive: { type: 'boolean', description: 'Include subdirectories (default: false)' }
        },
        async execute(params, workspaceRoot) {
            try {
                const dirPath = path.resolve(workspaceRoot, params.path || '.');

                validatePath(dirPath, workspaceRoot);

                if (!isWithinWorkspace(dirPath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }

                const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
                const lines: string[] = [];
                
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    
                    const prefix = entry.isDirectory() ? '📁' : '📄';
                    lines.push(`${prefix} ${entry.name}`);
                    
                    if (params.recursive && entry.isDirectory()) {
                        try {
                            const subEntries = await fsPromises.readdir(path.join(dirPath, entry.name));
                            for (const sub of subEntries.slice(0, 10)) {
                                lines.push(`  └─ ${sub}`);
                            }
                            if (subEntries.length > 10) {
                                lines.push(`  └─ ... (${subEntries.length - 10} more)`);
                            }
                        } catch { /* ignore */ }
                    }
                }
                
                return { success: true, output: lines.join('\n') || '(empty directory)' };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    run_command: {
        name: 'run_command',
        description: 'Execute a shell command in the workspace',
        parameters: {
            command: { type: 'string', description: 'Command to run', required: true },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.command) {
                    return { success: false, output: '', error: 'Missing required parameter: command' };
                }
                
                // Block dangerous commands
                const dangerous = ['rm -rf /', 'format', 'mkfs', ':(){', 'dd if='];
                if (dangerous.some(d => params.command.includes(d))) {
                    return { success: false, output: '', error: 'Dangerous command blocked' };
                }
                
                const timeout = params.timeout || 30000;
                const { stdout, stderr } = await execAsync(params.command, {
                    cwd: workspaceRoot,
                    timeout,
                    maxBuffer: 1024 * 1024 * 10 // 10MB
                });
                
                const output = stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
                return { success: true, output: output.trim() || '(no output)' };
            } catch (e: any) {
                // Include both error message and any output
                const output = e.stdout || '';
                const stderr = e.stderr || '';
                return { 
                    success: false, 
                    output: output + (stderr ? `\n[stderr]: ${stderr}` : ''),
                    error: e.message 
                };
            }
        }
    },

    search_files: {
        name: 'search_files',
        description: 'Search for text pattern in files',
        parameters: {
            pattern: { type: 'string', description: 'Text or regex to search', required: true },
            path: { type: 'string', description: 'Directory to search (default: workspace root)' },
            filePattern: { type: 'string', description: 'File glob pattern (e.g., "*.ts")' }
        },
        async execute(params, workspaceRoot) {
            const walkDir = async (dir: string, depth: number, regex: RegExp, filePattern: string | undefined, results: string[]): Promise<void> => {
                if (depth > 5) return;

                try {
                    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

                    for (const entry of entries) {
                        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                        const fullPath = path.join(dir, entry.name);

                        if (entry.isDirectory()) {
                            await walkDir(fullPath, depth + 1, regex, filePattern, results);
                        } else if (entry.isFile()) {
                            if (filePattern && !entry.name.match(filePattern.replace('*', '.*'))) continue;

                            try {
                                const content = await fsPromises.readFile(fullPath, 'utf-8');
                                const lines = content.split('\n');

                                lines.forEach((line, i) => {
                                    if (regex.test(line)) {
                                        const relPath = path.relative(workspaceRoot, fullPath);
                                        results.push(`${relPath}:${i + 1}: ${line.trim().substring(0, 100)}`);
                                    }
                                });
                            } catch { /* skip binary files */ }
                        }
                    }
                } catch { /* ignore permission errors */ }
            };

            try {
                if (!params.pattern) {
                    return { success: false, output: '', error: 'Missing required parameter: pattern' };
                }

                const searchDir = path.resolve(workspaceRoot, params.path || '.');
                validatePath(searchDir, workspaceRoot);
                if (!isWithinWorkspace(searchDir, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }

                const results: string[] = [];
                const regex = new RegExp(params.pattern, 'gi');

                await walkDir(searchDir, 0, regex, params.filePattern, results);

                if (results.length === 0) {
                    return { success: true, output: 'No matches found' };
                }

                return { success: true, output: results.slice(0, 50).join('\n') + (results.length > 50 ? `\n... (${results.length - 50} more)` : '') };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    delete_file: {
        name: 'delete_file',
        description: 'Delete a file',
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace', required: true }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path) {
                    return { success: false, output: '', error: 'Missing required parameter: path' };
                }
                const filePath = path.resolve(workspaceRoot, params.path);

                validatePath(filePath, workspaceRoot);

                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const writeCheck = canWrite(filePath, workspaceRoot);
                if (!writeCheck.allowed) {
                    return { success: false, output: '', error: writeCheck.reason };
                }

                await fsPromises.unlink(filePath);
                return { success: true, output: `Deleted ${params.path}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    run_tests: {
        name: 'run_tests',
        description: 'Run tests in the project. Auto-detects test framework.',
        parameters: {
            path: { type: 'string', description: 'Test file or directory (optional)' },
            pattern: { type: 'string', description: 'Test name pattern to match (optional)' }
        },
        async execute(params, workspaceRoot) {
            try {
                // Detect test framework
                let command = '';
                let framework = '';
                
                if (await fileExists(path.join(workspaceRoot, 'package.json'))) {
                    const pkgContent = await fsPromises.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8');
                    const pkg = JSON.parse(pkgContent);
                    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                    
                    if (deps['vitest']) {
                        framework = 'vitest';
                        command = 'npx vitest run --reporter=verbose';
                    } else if (deps['jest']) {
                        framework = 'jest';
                        command = 'npx jest --verbose';
                    } else if (deps['mocha']) {
                        framework = 'mocha';
                        command = 'npx mocha';
                    } else if (deps['playwright']) {
                        framework = 'playwright';
                        command = 'npx playwright test';
                    }
                }
                
                if (!command && await fileExists(path.join(workspaceRoot, 'pytest.ini')) || 
                    await fileExists(path.join(workspaceRoot, 'setup.py')) ||
                    await fileExists(path.join(workspaceRoot, 'pyproject.toml'))) {
                    framework = 'pytest';
                    command = 'python -m pytest -v --tb=short';
                }
                
                if (!command) {
                    return { success: false, output: '', error: 'Could not detect test framework. Supported: vitest, jest, mocha, playwright, pytest' };
                }
                
                if (params.path) {
                    command += ` ${params.path}`;
                }
                if (params.pattern) {
                    if (framework === 'pytest') {
                        command += ` -k "${params.pattern}"`;
                    } else if (framework === 'vitest' || framework === 'jest') {
                        command += ` -t "${params.pattern}"`;
                    }
                }
                
                try {
                    const { stdout, stderr } = await execAsync(command, {
                        cwd: workspaceRoot,
                        timeout: 120000,
                        maxBuffer: 1024 * 1024 * 10
                    });
                    return parseTestOutput(stdout + stderr, 0, command);
                } catch (e: any) {
                    return parseTestOutput((e.stdout || '') + (e.stderr || ''), e.code || 1, command);
                }
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    }
};

// Re-export VS Code tools
export { VSCODE_TOOLS } from './vscode';

// Export tool list for discovery
export function getToolList(): string[] {
    return Object.keys(TOOLS);
}

// Export tool descriptions for prompts
export function getToolDescriptions(): string {
    return Object.values(TOOLS).map(t => 
        `- ${t.name}: ${t.description}\n  Parameters: ${Object.entries(t.parameters).map(([k, v]) => `${k} (${v.type}${v.required ? ', required' : ''})`).join(', ')}`
    ).join('\n\n');
}
