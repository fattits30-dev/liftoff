// Core tools for autonomous agents
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { canRead, canWrite, isWithinWorkspace } from './security';
import { getLiftoffTerminal } from '../terminal';

const execAsync = promisify(exec);

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
    
    // If no output captured, provide helpful debugging info
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
                
                // Security checks
                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const readCheck = canRead(filePath, workspaceRoot);
                if (!readCheck.allowed) {
                    return { success: false, output: '', error: readCheck.reason };
                }
                
                let content = fs.readFileSync(filePath, 'utf-8');
                
                // Handle line range
                if (params.lines) {
                    const [start, end] = params.lines.split('-').map(Number);
                    const lines = content.split('\n');
                    content = lines.slice(start - 1, end).join('\n');
                    return { success: true, output: `Lines ${start}-${end}:\n${content}` };
                }
                
                // Truncate if too long
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
                
                // Security checks
                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }
                const writeCheck = canWrite(filePath, workspaceRoot);
                if (!writeCheck.allowed) {
                    return { success: false, output: '', error: writeCheck.reason };
                }
                
                // Create directory if needed
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                fs.writeFileSync(filePath, params.content, 'utf-8');
                const lines = params.content.split('\n').length;
                return { success: true, output: `Wrote ${lines} lines to ${params.path}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    patch_file: {
        name: 'patch_file',
        description: 'Apply a surgical edit to a file - find and replace specific text',
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            find: { type: 'string', description: 'Exact text to find', required: true },
            replace: { type: 'string', description: 'Text to replace with', required: true },
            replace_all: { type: 'boolean', description: 'Replace ALL occurrences (default: false, requires unique match)' }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path) {
                    return { success: false, output: '', error: 'Missing required parameter: path' };
                }
                if (params.find === undefined || params.find === null) {
                    return { success: false, output: '', error: 'Missing required parameter: find' };
                }
                if (params.replace === undefined || params.replace === null) {
                    return { success: false, output: '', error: 'Missing required parameter: replace' };
                }
                const filePath = path.resolve(workspaceRoot, params.path);

                // Security checks
                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace' };
                }
                const writeCheck = canWrite(filePath, workspaceRoot);
                if (!writeCheck.allowed) {
                    return { success: false, output: '', error: writeCheck.reason };
                }

                let content = fs.readFileSync(filePath, 'utf-8');
                const occurrences = content.split(params.find).length - 1;

                if (occurrences === 0) {
                    return { success: false, output: '', error: 'Text not found in file' };
                }

                // If multiple occurrences and replace_all not set, require unique match
                if (occurrences > 1 && !params.replace_all) {
                    return { success: false, output: '', error: `Text found ${occurrences} times - use replace_all: true to replace all, or add more context for unique match.` };
                }

                // Replace all occurrences or just the first one
                if (params.replace_all) {
                    content = content.split(params.find).join(params.replace);
                } else {
                    content = content.replace(params.find, params.replace);
                }
                fs.writeFileSync(filePath, content, 'utf-8');

                return { success: true, output: `Patched ${params.path}: replaced ${params.replace_all ? occurrences : 1} occurrence(s)` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    list_files: {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
            path: { type: 'string', description: 'Directory path (default: ".")', required: false },
            recursive: { type: 'boolean', description: 'Include subdirectories' }
        },
        async execute(params, workspaceRoot) {
            try {
                const dirPath = path.resolve(workspaceRoot, params.path || '.');

                if (!isWithinWorkspace(dirPath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace' };
                }

                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const output = entries
                    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
                    .map(item => `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`)
                    .join('\n');
                return { success: true, output: output || 'Empty directory' };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    delete_file: {
        name: 'delete_file',
        description: 'Delete a file. SAFETY: Only works in tests/, __tests__/, test/ directories. Cannot delete source code.',
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace', required: true },
            confirm: { type: 'boolean', description: 'Must be true to confirm deletion', required: true }
        },
        async execute(params, workspaceRoot) {
            try {
                if (!params.path) {
                    return { success: false, output: '', error: 'Missing required parameter: path' };
                }
                if (!params.confirm) {
                    return { success: false, output: '', error: 'Must set confirm: true to delete files' };
                }

                const filePath = path.resolve(workspaceRoot, params.path);

                // Security checks
                if (!isWithinWorkspace(filePath, workspaceRoot)) {
                    return { success: false, output: '', error: 'Path outside workspace not allowed' };
                }

                // SAFETY: Only allow deletion in test directories
                const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
                const allowedPatterns = [
                    /^tests?\//i,
                    /\/__tests__\//i,
                    /\/tests?\//i,
                    /^backend\/tests?\//i,
                    /^frontend\/tests?\//i,
                    /^__pycache__\//,
                    /\/__pycache__\//,
                    /^\.pytest_cache\//,
                    /\/\.pytest_cache\//,
                    /^node_modules\/\.cache\//
                ];

                const isAllowed = allowedPatterns.some(pattern => pattern.test(relativePath));
                if (!isAllowed) {
                    return {
                        success: false,
                        output: '',
                        error: `SAFETY: Can only delete files in test directories (tests/, __tests__/, __pycache__, .pytest_cache). Path: ${relativePath}`
                    };
                }

                // Check file exists
                if (!fs.existsSync(filePath)) {
                    return { success: false, output: '', error: `File not found: ${params.path}` };
                }

                // Delete the file
                fs.unlinkSync(filePath);
                return { success: true, output: `Deleted: ${params.path}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    search_files: {
        name: 'search_files',
        description: 'Search for text in files using regex or literal string',
        parameters: {
            pattern: { type: 'string', description: 'Search pattern (text or regex)', required: true },
            path: { type: 'string', description: 'Directory to search (default: ".")' },
            filePattern: { type: 'string', description: 'File glob like "*.ts" or "*.py"' },
            regex: { type: 'boolean', description: 'Treat pattern as regex' }
        },
        async execute(params, workspaceRoot) {
            try {
                const searchPath = path.resolve(workspaceRoot, params.path || '.');
                const results: string[] = [];
                const maxResults = 50;
                
                function searchDir(dir: string) {
                    if (results.length >= maxResults) return;
                    
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) break;
                        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                        
                        const fullPath = path.join(dir, entry.name);
                        
                        if (entry.isDirectory()) {
                            searchDir(fullPath);
                        } else if (entry.isFile()) {
                            // Check file pattern
                            if (params.filePattern) {
                                const ext = params.filePattern.replace('*', '');
                                if (!entry.name.endsWith(ext)) continue;
                            }
                            
                            try {
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                const lines = content.split('\n');
                                const regex = params.regex 
                                    ? new RegExp(params.pattern, 'gi')
                                    : null;
                                
                                lines.forEach((line, i) => {
                                    if (results.length >= maxResults) return;
                                    const matches = regex 
                                        ? regex.test(line)
                                        : line.includes(params.pattern);
                                    if (matches) {
                                        const relPath = path.relative(workspaceRoot, fullPath);
                                        results.push(`${relPath}:${i + 1}: ${line.trim().substring(0, 100)}`);
                                    }
                                });
                            } catch { /* skip binary files */ }
                        }
                    }
                }
                
                searchDir(searchPath);
                
                if (results.length === 0) {
                    return { success: true, output: 'No matches found' };
                }
                
                return { 
                    success: true, 
                    output: `Found ${results.length}${results.length >= maxResults ? '+' : ''} matches:\n${results.join('\n')}` 
                };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    run_command: {
        name: 'run_command',
        description: 'Execute a shell command in VS Code terminal. Use for npm, python, git, etc. For running tests, use run_tests instead. Use "npx" for local node_modules binaries.',
        parameters: {
            command: { type: 'string', description: 'Command to execute. Use "npx <tool>" for local packages, "npm run <script>" for package.json scripts.', required: true },
            timeout: { type: 'number', description: 'Timeout in ms (default 60000)' }
        },
        async execute(params, workspaceRoot) {
            if (!params.command) {
                return { success: false, output: '', error: 'Missing required parameter: command' };
            }
            const timeout = params.timeout || 60000;

            // Try VS Code terminal first
            let terminalManager: ReturnType<typeof getLiftoffTerminal> | null = null;
            try {
                terminalManager = getLiftoffTerminal();
            } catch (initError: any) {
                console.error('[run_command] Failed to get terminal manager:', initError);
            }

            if (terminalManager) {
                try {
                    const { output, exitCode } = await terminalManager.runCommand(
                        params.command,
                        workspaceRoot,
                        timeout
                    );
                    return {
                        success: exitCode === 0,
                        output: output || 'Command completed with no output',
                        error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined
                    };
                } catch (terminalError: any) {
                    console.error('[run_command] Terminal execution failed:', terminalError);
                    // Fall through to execAsync
                }
            }

            // Fallback to execAsync
            try {
                const { stdout, stderr } = await execAsync(params.command, {
                    cwd: workspaceRoot,
                    timeout,
                    maxBuffer: 1024 * 1024 * 50,
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                });
                return {
                    success: true,
                    output: stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
                };
            } catch (e: any) {
                return {
                    success: false,
                    output: e.stdout || '',
                    error: e.stderr || e.message || 'Command execution failed'
                };
            }
        }
    },

    run_tests: {
        name: 'run_tests',
        description: 'Run test suite in VS Code terminal. For vitest: use "npx vitest run". For pytest: use "python -m pytest -v --tb=short" (shows verbose output with traceback).',
        parameters: {
            command: { type: 'string', description: 'Test command. Examples: "npm test", "npx vitest run", "python -m pytest tests/ -v --tb=short". For pytest ALWAYS use -v and --tb=short for visible errors!', required: true },
            timeout: { type: 'number', description: 'Timeout in ms (default 180000 for tests - 3 minutes)' }
        },
        async execute(params, workspaceRoot) {
            if (!params.command) {
                return { success: false, output: '', error: 'Missing required parameter: command' };
            }
            const timeout = params.timeout || 180000; // 3 minutes for tests

            // Try VS Code terminal first (best output visibility)
            let terminalManager: ReturnType<typeof getLiftoffTerminal> | null = null;
            try {
                terminalManager = getLiftoffTerminal();
            } catch (initError: any) {
                console.error('[run_tests] Failed to get terminal manager:', initError);
            }

            if (terminalManager) {
                try {
                    const { output, exitCode } = await terminalManager.runCommand(
                        params.command,
                        workspaceRoot,
                        timeout
                    );
                    return parseTestOutput(output, exitCode, params.command);
                } catch (terminalError: any) {
                    console.error('[run_tests] Terminal execution failed:', terminalError);
                    // Fall through to execAsync
                }
            }

            // Fallback to execAsync with improved capture
            try {
                // For pytest, ensure unbuffered output
                const enhancedEnv = {
                    ...process.env,
                    FORCE_COLOR: '0',
                    NO_COLOR: '1',
                    CI: '1',
                    PYTHONUNBUFFERED: '1', // Force unbuffered Python output
                    PYTEST_ADDOPTS: '-v --tb=short' // Ensure pytest verbosity
                };

                const { stdout, stderr } = await execAsync(params.command, {
                    cwd: workspaceRoot,
                    timeout,
                    maxBuffer: 1024 * 1024 * 100,
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
                    env: enhancedEnv,
                    windowsHide: true,
                });

                // Combine stdout and stderr - pytest often writes to stderr
                const fullOutput = [stdout, stderr].filter(Boolean).join('\n');
                return parseTestOutput(fullOutput, 0, params.command);

            } catch (err: any) {
                const stdout = err.stdout || '';
                const stderr = err.stderr || '';
                // Combine all output - pytest errors go to stderr
                const fullOutput = [stdout, stderr].filter(Boolean).join('\n');
                const exitCode = err.code || 1;

                if (!fullOutput.trim()) {
                    // More helpful error when no output captured
                    return {
                        success: false,
                        output: `Command failed with no visible output.
Command: ${params.command}
Working directory: ${workspaceRoot}
Exit code: ${exitCode}
Error: ${err.message}

TIP: For pytest, use "python -m pytest tests/ -v --tb=short" to see detailed errors.
TIP: For vitest, use "npx vitest run" instead of bare "vitest".`,
                        error: err.message || `Exit code ${exitCode}`
                    };
                }

                return parseTestOutput(fullOutput, exitCode, params.command);
            }
        }
    },

    task_complete: {
        name: 'task_complete',
        description: 'Signal that the task is complete with a summary',
        parameters: {
            summary: { type: 'string', description: 'Summary of what was done', required: true },
            success: { type: 'boolean', description: 'Whether task succeeded' }
        },
        async execute(params) {
            return { success: true, output: `TASK_COMPLETE: ${params.summary}` };
        }
    },

    ask_user: {
        name: 'ask_user',
        description: 'Ask the user a question and wait for their response',
        parameters: {
            question: { type: 'string', description: 'Question to ask', required: true }
        },
        async execute(params) {
            return { success: true, output: `WAITING_FOR_USER: ${params.question}` };
        }
    }
};

export function getToolsDescription(): string {
    return Object.values(TOOLS).map(tool => {
        const params = Object.entries(tool.parameters)
            .map(([name, p]) => `  - ${name}${p.required ? '*' : ''}: ${p.description}`)
            .join('\n');
        return `## ${tool.name}\n${tool.description}\n${params}`;
    }).join('\n\n');
}

// Export VS Code tools
export { VSCODE_TOOLS, getVSCodeToolsDescription } from './vscode';
