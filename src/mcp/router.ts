// MCP Tool Router - Discovers and routes tool calls to appropriate servers
// Implements efficient tool calling to minimize token usage

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McpClient } from './client';
import { McpServerConfig, McpTool, ToolCallResult, McpToolResult } from './types';

export interface ToolDefinition {
    name: string;
    server: string;
    description: string;
    parameters: Record<string, {
        type: string;
        description?: string;
        required?: boolean;
    }>;
}

export class McpRouter {
    private clients = new Map<string, McpClient>();
    private toolIndex = new Map<string, { server: string; tool: McpTool }>();
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Liftoff MCP');
    }

    /**
     * Load MCP server configs from workspace or user settings
     */
    async loadConfig(workspaceRoot: string): Promise<McpServerConfig[]> {
        const configs: McpServerConfig[] = [];

        // Check for .mcp.json in workspace
        const mcpConfigPath = path.join(workspaceRoot, '.mcp.json');
        this.log(`Looking for MCP config at: ${mcpConfigPath}`);
        
        if (fs.existsSync(mcpConfigPath)) {
            this.log(`Found .mcp.json, loading...`);
            try {
                const content = fs.readFileSync(mcpConfigPath, 'utf-8');
                const config = JSON.parse(content);
                if (config.servers) {
                    for (const [name, serverConfig] of Object.entries(config.servers as Record<string, any>)) {
                        configs.push({
                            name,
                            command: serverConfig.command,
                            args: serverConfig.args,
                            env: serverConfig.env,
                            cwd: serverConfig.cwd || workspaceRoot,
                            enabled: serverConfig.enabled !== false
                        });
                    }
                }
            } catch (err) {
                this.log(`Failed to load .mcp.json: ${err}`);
            }
            this.log(`Loaded ${configs.length} server config(s)`);
        } else {
            this.log(`No .mcp.json found at ${mcpConfigPath}`);
        }

        return configs.filter(c => c.enabled);
    }

    /**
     * Connect to all configured MCP servers
     */
    async connectAll(configs: McpServerConfig[]): Promise<void> {
        const connectPromises = configs.map(async (config) => {
            try {
                const client = new McpClient(config);
                await client.connect();
                this.clients.set(config.name, client);

                // Index all tools from this server
                for (const tool of client.tools) {
                    this.toolIndex.set(tool.name, { server: config.name, tool });
                    // Also index with server prefix for disambiguation
                    this.toolIndex.set(`${config.name}__${tool.name}`, { server: config.name, tool });
                }

                this.log(`Connected to ${config.name}: ${client.tools.length} tools available`);
            } catch (err: any) {
                this.log(`Failed to connect to ${config.name}: ${err.message}`);
            }
        });

        await Promise.all(connectPromises);
    }

    /**
     * Get all available tools in a compact format for the model
     * This is the token-efficient tool description format
     */
    getToolsCompact(): string {
        const tools: string[] = [];

        for (const [name, { server, tool }] of this.toolIndex) {
            // Skip duplicates (prefixed versions)
            if (name.includes('__')) continue;

            const params = Object.entries(tool.inputSchema?.properties || {})
                .map(([pname, pdef]) => {
                    const req = tool.inputSchema?.required?.includes(pname) ? '*' : '';
                    const ptype = pdef?.type || 'any';
                    return `${pname}${req}:${ptype}`;
                })
                .join(', ');

            const desc = (tool.description || 'No description').substring(0, 80);
            tools.push(`${name}(${params}) - ${desc}`);
        }

        return tools.join('\n');
    }

    /**
     * Get tools in JSON schema format (for models that support it)
     */
    getToolsJsonSchema(): any[] {
        const tools: any[] = [];

        for (const [name, { tool }] of this.toolIndex) {
            if (name.includes('__')) continue;

            tools.push({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema
            });
        }

        return tools;
    }

    /**
     * Execute a tool call efficiently
     */
    async callTool(name: string, args: Record<string, any>): Promise<ToolCallResult> {
        const entry = this.toolIndex.get(name);
        if (!entry) {
            return {
                success: false,
                output: '',
                error: `Unknown tool: ${name}. Available: ${Array.from(this.toolIndex.keys()).filter(k => !k.includes('__')).join(', ')}`
            };
        }

        const client = this.clients.get(entry.server);
        if (!client || client.status !== 'ready') {
            return {
                success: false,
                output: '',
                error: `Server ${entry.server} not connected`
            };
        }

        try {
            const result: McpToolResult = await client.callTool(name, args);

            // Extract text content from MCP result format
            const textContent = result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');

            return {
                success: !result.isError,
                output: textContent || 'No output',
                error: result.isError ? textContent : undefined,
                server: entry.server
            };
        } catch (err: any) {
            return {
                success: false,
                output: '',
                error: err.message,
                server: entry.server
            };
        }
    }

    /**
     * Execute multiple tool calls in parallel (batch mode)
     */
    async callToolsBatch(calls: Array<{ name: string; args: Record<string, any> }>): Promise<ToolCallResult[]> {
        return Promise.all(calls.map(call => this.callTool(call.name, call.args)));
    }

    /**
     * Parse tool calls from model output
     * Supports multiple formats:
     * 1. JSON array: [{"name": "tool", "args": {...}}]
     * 2. Single JSON: {"name": "tool", "args": {...}}
     * 3. XML-style: <tool name="x">{"arg": "val"}</tool>
     */
    parseToolCalls(text: string): Array<{ name: string; args: Record<string, any> }> | null {
        const calls: Array<{ name: string; args: Record<string, any> }> = [];

        // Try JSON array format first (most efficient)
        const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        if (jsonArrayMatch) {
            try {
                const parsed = JSON.parse(jsonArrayMatch[0]);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (item.name) {
                            // Support both nested args and flat format
                            const { name, args, ...rest } = item;
                            calls.push({ name, args: args || rest });
                        }
                    }
                    if (calls.length > 0) return calls;
                }
            } catch {}
        }

        // Try single JSON object
        const jsonMatch = text.match(/\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?"args"\s*:\s*(\{[\s\S]*?\})\s*\}/);
        if (jsonMatch) {
            try {
                const name = jsonMatch[1];
                const args = JSON.parse(jsonMatch[2]);
                return [{ name, args }];
            } catch {}
        }

        // Try XML-style format (legacy compatibility)
        const toolMatches = text.matchAll(/<tool\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/tool>/gi);
        for (const match of toolMatches) {
            try {
                const name = match[1];
                const args = JSON.parse(match[2].trim());
                calls.push({ name, args });
            } catch {}
        }

        // Try simple tool block format
        const blockMatch = text.match(/```tool\s*\n([\s\S]*?)```/);
        if (blockMatch) {
            try {
                const parsed = JSON.parse(blockMatch[1]);
                if (parsed.name) {
                    // Support both nested args and flat format
                    const { name, args, ...rest } = parsed;
                    return [{ name, args: args || rest }];
                }
            } catch {}
        }

        return calls.length > 0 ? calls : null;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        console.log(`[McpRouter] ${message}`);
    }

    /**
     * Disconnect all servers
     */
    dispose(): void {
        for (const client of this.clients.values()) {
            client.disconnect();
        }
        this.clients.clear();
        this.toolIndex.clear();
        this.outputChannel.dispose();
    }
}

// Singleton instance
let routerInstance: McpRouter | null = null;

export function getMcpRouter(): McpRouter {
    if (!routerInstance) {
        routerInstance = new McpRouter();
    }
    return routerInstance;
}

export function disposeMcpRouter(): void {
    if (routerInstance) {
        routerInstance.dispose();
        routerInstance = null;
    }
}
