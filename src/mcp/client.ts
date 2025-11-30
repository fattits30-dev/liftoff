// MCP Client - Connects to MCP servers via stdio
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import * as vscode from 'vscode';
import {
    JsonRpcRequest,
    JsonRpcResponse,
    McpServerConfig,
    McpTool,
    McpToolResult,
    McpInitializeResult,
    McpServerCapabilities
} from './types';

// Shared output channel for all MCP clients
let mcpOutputChannel: vscode.OutputChannel | null = null;

function getMcpOutputChannel(): vscode.OutputChannel {
    if (!mcpOutputChannel) {
        mcpOutputChannel = vscode.window.createOutputChannel('Liftoff MCP');
    }
    return mcpOutputChannel;
}

export function disposeMcpOutputChannel(): void {
    mcpOutputChannel?.dispose();
    mcpOutputChannel = null;
}

export class McpClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number | string, {
        resolve: (result: any) => void;
        reject: (error: Error) => void;
    }>();
    private readline: readline.Interface | null = null;
    private buffer = '';
    private outputChannel: vscode.OutputChannel;

    public serverInfo: { name: string; version: string } | null = null;
    public capabilities: McpServerCapabilities | null = null;
    public tools: McpTool[] = [];
    public status: 'disconnected' | 'connecting' | 'ready' | 'error' = 'disconnected';

    constructor(public readonly config: McpServerConfig) {
        super();
        this.outputChannel = getMcpOutputChannel();
    }
    
    private log(message: string): void {
        this.outputChannel.appendLine(`[MCP:${this.config.name}] ${message}`);
    }

    async connect(): Promise<void> {
        if (this.status === 'ready') return;

        this.status = 'connecting';

        return new Promise((resolve, reject) => {
            try {
                // Spawn the MCP server process
                const isWindows = process.platform === 'win32';
                const command = this.config.command;
                const args = this.config.args || [];

                // SECURITY: Allowlist of permitted MCP server commands
                const ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3', 'uvx'];

                if (!ALLOWED_COMMANDS.includes(command)) {
                    throw new Error(
                        `Forbidden MCP command: ${command}. ` +
                        `Allowed commands: ${ALLOWED_COMMANDS.join(', ')}`
                    );
                }

                // SECURITY FIX: Use shell: false to prevent command injection
                // The allowlist above ensures only safe executables are spawned
                this.process = spawn(command, args, {
                    cwd: this.config.cwd,
                    env: { ...process.env, ...this.config.env },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: false,
                    windowsHide: isWindows
                });

                // Handle stdout - JSON-RPC responses come here
                this.readline = readline.createInterface({
                    input: this.process.stdout!,
                    crlfDelay: Infinity
                });

                this.readline.on('line', (line) => {
                    this.handleLine(line);
                });

                // Handle stderr - log errors but don't fail
                this.process.stderr?.on('data', (data) => {
                    const msg = data.toString().trim();
                    if (msg) {
                        this.log(`stderr: ${msg}`);
                    }
                });

                // Handle process exit
                this.process.on('exit', (code) => {
                    this.log(`Process exited with code ${code}`);
                    this.status = 'disconnected';
                    this.emit('disconnected');
                });

                this.process.on('error', (err) => {
                    this.log(`Process error: ${err.message}`);
                    this.status = 'error';
                    reject(err);
                });

                // Give the process a moment to start, then initialize
                setTimeout(async () => {
                    try {
                        await this.initialize();
                        await this.listTools();
                        this.status = 'ready';
                        this.emit('ready');
                        resolve();
                    } catch (err) {
                        this.status = 'error';
                        reject(err);
                    }
                }, 500);

            } catch (err) {
                this.status = 'error';
                reject(err);
            }
        });
    }

    private handleLine(line: string): void {
        if (!line.trim()) return;

        try {
            const response: JsonRpcResponse = JSON.parse(line);

            if (response.id !== undefined) {
                const pending = this.pendingRequests.get(response.id);
                if (pending) {
                    this.pendingRequests.delete(response.id);
                    if (response.error) {
                        pending.reject(new Error(response.error.message));
                    } else {
                        pending.resolve(response.result);
                    }
                }
            }
        } catch (_err) {
            // Not valid JSON - might be debug output
            this.log(`Non-JSON output: ${line}`);
        }
    }

    private async sendRequest(method: string, params?: Record<string, any>): Promise<any> {
        if (!this.process || !this.process.stdin) {
            throw new Error('MCP client not connected');
        }

        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            // Set timeout
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, 30000);

            this.pendingRequests.set(id, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            const json = JSON.stringify(request) + '\n';
            this.process!.stdin!.write(json);
        });
    }

    private async initialize(): Promise<McpInitializeResult> {
        const result = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                // Don't advertise roots - we pass directory via server args instead
            },
            clientInfo: {
                name: 'liftoff',
                version: '0.1.0'
            }
        });

        this.serverInfo = result.serverInfo;
        this.capabilities = result.capabilities;

        // Send initialized notification
        const notification = {
            jsonrpc: '2.0',
            method: 'notifications/initialized'
        };
        this.process!.stdin!.write(JSON.stringify(notification) + '\n');

        this.log(`Connected to ${result.serverInfo.name} v${result.serverInfo.version}`);
        return result;
    }

    async listTools(): Promise<McpTool[]> {
        const result = await this.sendRequest('tools/list');
        this.tools = result.tools || [];
        this.log(`Found ${this.tools.length} tools`);
        return this.tools;
    }

    async callTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
        if (this.status !== 'ready') {
            throw new Error(`MCP client ${this.config.name} not ready`);
        }

        const result = await this.sendRequest('tools/call', {
            name,
            arguments: args
        });

        return result;
    }

    disconnect(): void {
        if (this.readline) {
            this.readline.close();
            this.readline = null;
        }
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.status = 'disconnected';
        this.pendingRequests.clear();
    }
}
