/**
 * Enhanced MCP Router
 * Adds retry logic, fallback chains, health-aware routing, and batch execution
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McpClient } from './client';
import { McpServerManager, ServerHealth } from './server-manager';
import { LocalMcpServer, McpToolResult } from './local-server';
import { IEventBus } from '../core/interfaces/IEventBus';
import { McpServerConfig, McpTool, ToolCallResult } from './types';

export interface ExecutionOptions {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    fallbackEnabled?: boolean;
    priority?: 'low' | 'normal' | 'high';
}

export interface BatchResult {
    results: Map<string, ToolCallResult>;
    duration: number;
    failedCount: number;
    successCount: number;
}

export interface ToolDefinition {
    name: string;
    server: string;
    description: string;
    parameters: Record<string, {
        type: string;
        description?: string;
        required?: boolean;
    }>;
    source: 'local' | 'mcp';
}

const DEFAULT_OPTIONS: Required<ExecutionOptions> = {
    timeout: 60000,
    retries: 3,
    retryDelay: 1000,
    fallbackEnabled: true,
    priority: 'normal',
};

export class EnhancedMcpRouter {
    private clients = new Map<string, McpClient>();
    private toolIndex = new Map<string, { server: string; tool: McpTool; source: 'local' | 'mcp' }>();
    private serverManager: McpServerManager;
    private localServer: LocalMcpServer | null = null;
    private outputChannel: vscode.OutputChannel;
    private eventBus?: IEventBus;
    private workspaceRoot: string = '';

    constructor(eventBus?: IEventBus) {
        this.eventBus = eventBus;
        this.serverManager = new McpServerManager(eventBus);
        this.outputChannel = vscode.window.createOutputChannel('Liftoff MCP Enhanced');
    }

    /**
     * Initialize the router with workspace
     */
    async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;

        // Initialize local server
        this.localServer = new LocalMcpServer({
            workspaceRoot,
            eventBus: this.eventBus,
        });

        // Index local tools
        const localTools = await this.localServer.listTools();
        for (const tool of localTools) {
            this.toolIndex.set(tool.name, {
                server: 'local',
                tool: tool as McpTool,
                source: 'local',
            });
        }

        this.log(`Initialized with ${localTools.length} local tools`);

        // Load and connect MCP servers
        const configs = await this.loadConfig(workspaceRoot);
        await this.connectAll(configs);
    }

    /**
     * Load MCP server configs
     */
    async loadConfig(workspaceRoot: string): Promise<McpServerConfig[]> {
        const configs: McpServerConfig[] = [];
        const mcpConfigPath = path.join(workspaceRoot, '.mcp.json');

        if (fs.existsSync(mcpConfigPath)) {
            try {
                const content = fs.readFileSync(mcpConfigPath, 'utf-8');
                const config = JSON.parse(content);
                if (config.servers) {
                    for (const [name, serverConfig] of Object.entries(config.servers as Record<string, unknown>)) {
                        const sc = serverConfig as Record<string, unknown>;
                        configs.push({
                            name,
                            command: sc.command as string,
                            args: sc.args as string[],
                            env: sc.env as Record<string, string>,
                            cwd: (sc.cwd as string) || workspaceRoot,
                            enabled: sc.enabled !== false,
                        });
                    }
                }
            } catch (err) {
                this.log(`Failed to load .mcp.json: ${err}`);
            }
        }

        return configs.filter(c => c.enabled);
    }

    /**
     * Connect to all configured MCP servers
     */
    async connectAll(configs: McpServerConfig[]): Promise<void> {
        for (const config of configs) {
            try {
                // Use server manager for better lifecycle control
                await this.serverManager.startServer({
                    name: config.name,
                    command: config.command,
                    args: config.args,
                    env: config.env,
                    cwd: config.cwd,
                });

                const client = this.serverManager.getClient(config.name);
                if (client) {
                    this.clients.set(config.name, client);

                    // Index tools from this server
                    for (const tool of client.tools) {
                        this.toolIndex.set(tool.name, {
                            server: config.name,
                            tool,
                            source: 'mcp',
                        });
                        // Also index with server prefix
                        this.toolIndex.set(`${config.name}__${tool.name}`, {
                            server: config.name,
                            tool,
                            source: 'mcp',
                        });
                    }

                    this.log(`Connected to ${config.name}: ${client.tools.length} tools`);
                }
            } catch (err) {
                this.log(`Failed to connect to ${config.name}: ${err}`);
            }
        }
    }

    /**
     * Execute a tool call with retry and fallback support
     */
    async callTool(
        name: string,
        args: Record<string, unknown>,
        options?: ExecutionOptions
    ): Promise<ToolCallResult> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const startTime = Date.now();

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('tool:executing', { name, args, options: opts });
        }

        const entry = this.toolIndex.get(name);
        if (!entry) {
            return this.createErrorResult(name, `Unknown tool: ${name}`);
        }

        // Try execution with retries
        let lastError: string | undefined;
        for (let attempt = 1; attempt <= opts.retries; attempt++) {
            try {
                const result = await this.executeWithTimeout(name, args, entry, opts.timeout);

                if (result.success) {
                    const duration = Date.now() - startTime;
                    if (this.eventBus) {
                        this.eventBus.emit('tool:completed', {
                            name,
                            args,
                            duration,
                            attempt,
                            server: entry.server,
                        });
                    }
                    return { ...result, duration };
                }

                lastError = result.error;
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }

            // Check if we should retry
            if (attempt < opts.retries) {
                const delay = opts.retryDelay * Math.pow(2, attempt - 1);
                this.log(`Retry ${attempt}/${opts.retries} for ${name} after ${delay}ms`);
                await this.sleep(delay);
            }
        }

        // Try fallback to local server if enabled and this was an MCP tool
        if (opts.fallbackEnabled && entry.source === 'mcp' && this.localServer) {
            const localToolName = this.getLocalFallbackName(name);
            if (localToolName && this.localServer.hasTool(localToolName)) {
                this.log(`Falling back to local tool: ${localToolName}`);
                try {
                    const localResult = await this.localServer.callTool(localToolName, args as Record<string, unknown>);
                    return this.convertMcpResult(localResult, 'local');
                } catch (err) {
                    lastError = err instanceof Error ? err.message : String(err);
                }
            }
        }

        // All retries exhausted
        const duration = Date.now() - startTime;
        if (this.eventBus) {
            this.eventBus.emit('tool:failed', { name, args, error: lastError, duration });
        }

        return this.createErrorResult(name, lastError || 'Unknown error', entry.server);
    }

    /**
     * Execute with timeout
     */
    private async executeWithTimeout(
        name: string,
        args: Record<string, unknown>,
        entry: { server: string; tool: McpTool; source: 'local' | 'mcp' },
        timeout: number
    ): Promise<ToolCallResult> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Tool ${name} timed out after ${timeout}ms`));
            }, timeout);

            this.executeToolInternal(name, args, entry)
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    /**
     * Execute tool internally
     */
    private async executeToolInternal(
        name: string,
        args: Record<string, unknown>,
        entry: { server: string; tool: McpTool; source: 'local' | 'mcp' }
    ): Promise<ToolCallResult> {
        if (entry.source === 'local' && this.localServer) {
            const result = await this.localServer.callTool(name, args);
            return this.convertMcpResult(result, 'local');
        }

        const client = this.clients.get(entry.server);
        if (!client || client.status !== 'ready') {
            // Check health and try to reconnect
            const health = await this.serverManager.checkHealth(entry.server);
            if (health.status !== 'connected') {
                throw new Error(`Server ${entry.server} not available`);
            }
        }

        const result = await client!.callTool(name, args);
        return this.convertMcpResult(result, entry.server);
    }

    /**
     * Convert MCP result format to ToolCallResult
     */
    private convertMcpResult(result: McpToolResult, server: string): ToolCallResult {
        const textContent = result.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

        return {
            success: !result.isError,
            output: textContent || 'No output',
            error: result.isError ? textContent : undefined,
            server,
        };
    }

    /**
     * Execute multiple tool calls in parallel with priority ordering
     */
    async callToolsBatch(
        calls: Array<{ name: string; args: Record<string, unknown> }>,
        options?: ExecutionOptions
    ): Promise<BatchResult> {
        const startTime = Date.now();
        const results = new Map<string, ToolCallResult>();
        let failedCount = 0;
        let successCount = 0;

        // Execute all calls in parallel
        const promises = calls.map(async (call, index) => {
            const result = await this.callTool(call.name, call.args, options);
            const key = `${call.name}:${index}`;
            results.set(key, result);

            if (result.success) {
                successCount++;
            } else {
                failedCount++;
            }
        });

        await Promise.all(promises);

        return {
            results,
            duration: Date.now() - startTime,
            failedCount,
            successCount,
        };
    }

    /**
     * Get local fallback tool name
     */
    private getLocalFallbackName(mcpToolName: string): string | null {
        // Map common MCP tool patterns to local tools
        const mappings: Record<string, string> = {
            'read_file': 'local_fs_read',
            'write_file': 'local_fs_write',
            'list_directory': 'local_fs_list',
            'execute_command': 'local_shell_run',
        };

        return mappings[mcpToolName] || null;
    }

    /**
     * Create error result
     */
    private createErrorResult(name: string, error: string, server?: string): ToolCallResult {
        return {
            success: false,
            output: '',
            error,
            server,
        };
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get all available tools in compact format
     */
    getToolsCompact(): string {
        const tools: string[] = [];

        for (const [name, { tool }] of this.toolIndex) {
            if (name.includes('__')) continue;

            const params = Object.entries(tool.inputSchema?.properties || {})
                .map(([pname, pdef]) => {
                    const schema = pdef as { type?: string };
                    const req = tool.inputSchema?.required?.includes(pname) ? '*' : '';
                    return `${pname}${req}:${schema.type || 'any'}`;
                })
                .join(', ');

            const desc = (tool.description || 'No description').substring(0, 80);
            tools.push(`${name}(${params}) - ${desc}`);
        }

        return tools.join('\n');
    }

    /**
     * Get tools in JSON schema format
     */
    getToolsJsonSchema(): Array<{
        name: string;
        description: string;
        input_schema: unknown;
    }> {
        const tools: Array<{
            name: string;
            description: string;
            input_schema: unknown;
        }> = [];

        for (const [name, { tool }] of this.toolIndex) {
            if (name.includes('__')) continue;

            tools.push({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            });
        }

        return tools;
    }

    /**
     * Get server health statuses
     */
    getServerHealth(): Map<string, ServerHealth> {
        return this.serverManager.getAllStatuses();
    }

    /**
     * Check if a tool exists
     */
    hasTool(name: string): boolean {
        return this.toolIndex.has(name);
    }

    /**
     * Get tool info
     */
    getToolInfo(name: string): ToolDefinition | null {
        const entry = this.toolIndex.get(name);
        if (!entry) return null;

        const properties: Record<string, {
            type: string;
            description?: string;
            required?: boolean;
        }> = {};

        for (const [pname, pdef] of Object.entries(entry.tool.inputSchema?.properties || {})) {
            const schema = pdef as { type?: string; description?: string };
            properties[pname] = {
                type: schema.type || 'any',
                description: schema.description,
                required: entry.tool.inputSchema?.required?.includes(pname),
            };
        }

        return {
            name: entry.tool.name,
            server: entry.server,
            description: entry.tool.description,
            parameters: properties,
            source: entry.source,
        };
    }

    /**
     * Parse tool calls from model output
     */
    parseToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> | null {
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

        // Try JSON array format
        const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        if (jsonArrayMatch) {
            try {
                const parsed = JSON.parse(jsonArrayMatch[0]);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (item.name) {
                            const { name, args, ...rest } = item;
                            calls.push({ name, args: args || rest });
                        }
                    }
                    if (calls.length > 0) return calls;
                }
            } catch { /* continue */ }
        }

        // Try single JSON object
        const jsonMatch = text.match(/\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?"args"\s*:\s*(\{[\s\S]*?\})\s*\}/);
        if (jsonMatch) {
            try {
                const name = jsonMatch[1];
                const args = JSON.parse(jsonMatch[2]);
                return [{ name, args }];
            } catch { /* continue */ }
        }

        // Try tool block format
        const blockMatch = text.match(/```tool\s*\n([\s\S]*?)```/);
        if (blockMatch) {
            try {
                const parsed = JSON.parse(blockMatch[1]);
                if (parsed.name) {
                    const { name, args, ...rest } = parsed;
                    return [{ name, args: args || rest }];
                }
            } catch { /* continue */ }
        }

        return calls.length > 0 ? calls : null;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Cleanup and disconnect
     */
    async dispose(): Promise<void> {
        await this.serverManager.shutdown();
        this.clients.clear();
        this.toolIndex.clear();
        this.outputChannel.dispose();
    }
}

// Singleton
let enhancedRouterInstance: EnhancedMcpRouter | null = null;

export function getEnhancedMcpRouter(eventBus?: IEventBus): EnhancedMcpRouter {
    if (!enhancedRouterInstance) {
        enhancedRouterInstance = new EnhancedMcpRouter(eventBus);
    }
    return enhancedRouterInstance;
}

export function disposeEnhancedMcpRouter(): Promise<void> {
    if (enhancedRouterInstance) {
        const instance = enhancedRouterInstance;
        enhancedRouterInstance = null;
        return instance.dispose();
    }
    return Promise.resolve();
}
