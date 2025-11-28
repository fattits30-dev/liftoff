// MCP Client - Connects to MCP servers via stdio
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import {
    JsonRpcRequest,
    JsonRpcResponse,
    McpServerConfig,
    McpTool,
    McpToolResult,
    McpInitializeResult,
    McpServerCapabilities
} from './types';

export class McpClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number | string, {
        resolve: (result: any) => void;
        reject: (error: Error) => void;
    }>();
    private readline: readline.Interface | null = null;
    private buffer = '';

    public serverInfo: { name: string; version: string } | null = null;
    public capabilities: McpServerCapabilities | null = null;
    public tools: McpTool[] = [];
    public status: 'disconnected' | 'connecting' | 'ready' | 'error' = 'disconnected';

    constructor(public readonly config: McpServerConfig) {
        super();
    }

    async connect(): Promise<void> {
        if (this.status === 'ready') return;

        this.status = 'connecting';

        return new Promise((resolve, reject) => {
            try {
                // Spawn the MCP server process
                // On Windows, use cmd /c for npx commands to handle paths with spaces
                const isWindows = process.platform === 'win32';
                const command = this.config.command;
                const args = this.config.args || [];
                
                // Always use shell: true to ensure PATH is searched for executables
                // Node.js handles argument escaping properly in shell mode
                this.process = spawn(command, args, {
                    cwd: this.config.cwd,
                    env: { ...process.env, ...this.config.env },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true,
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
                        console.error(`[MCP:${this.config.name}] stderr:`, msg);
                    }
                });

                // Handle process exit
                this.process.on('exit', (code) => {
                    console.log(`[MCP:${this.config.name}] Process exited with code ${code}`);
                    this.status = 'disconnected';
                    this.emit('disconnected');
                });

                this.process.on('error', (err) => {
                    console.error(`[MCP:${this.config.name}] Process error:`, err);
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
        } catch (err) {
            // Not valid JSON - might be debug output
            console.log(`[MCP:${this.config.name}] Non-JSON output:`, line);
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

        console.log(`[MCP:${this.config.name}] Connected to ${result.serverInfo.name} v${result.serverInfo.version}`);
        return result;
    }

    async listTools(): Promise<McpTool[]> {
        const result = await this.sendRequest('tools/list');
        this.tools = result.tools || [];
        console.log(`[MCP:${this.config.name}] Found ${this.tools.length} tools`);
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
