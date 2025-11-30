/**
 * Local Tools MCP Server
 *
 * Wraps existing browser, git, and testing tools in MCP-compatible format.
 * Runs in-process (no subprocess overhead) and maintains state (e.g., BrowserManager).
 */

import { McpTool, McpToolResult } from './types';
import { Tool, ToolResult, TOOLS } from '../tools/index';
import { BROWSER_TOOLS } from '../tools/browser';
import { GIT_TOOLS } from '../tools/git';

/**
 * Converts Tool parameter definition to MCP inputSchema format
 */
function convertParametersToInputSchema(
    parameters: Record<string, { type: string; description: string; required?: boolean }>
): McpTool['inputSchema'] {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(parameters)) {
        properties[name] = {
            type: param.type,
            description: param.description
        };

        if (param.required) {
            required.push(name);
        }
    }

    return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
    };
}

/**
 * Converts ToolResult to MCP format
 */
function convertToolResultToMcp(result: ToolResult): McpToolResult {
    if (result.success) {
        return {
            content: [{
                type: 'text',
                text: result.output
            }],
            isError: false
        };
    } else {
        return {
            content: [{
                type: 'text',
                text: result.error || result.output || 'Tool execution failed'
            }],
            isError: true
        };
    }
}

/**
 * Local Tools Server - provides browser, git, and testing tools via MCP protocol
 */
export class LocalToolsServer {
    private workspaceRoot: string;
    private tools: Map<string, Tool>;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.tools = new Map();

        // Register all browser tools
        for (const [name, tool] of Object.entries(BROWSER_TOOLS)) {
            this.tools.set(`local__${name}`, tool);
        }

        // Register all git tools
        for (const [name, tool] of Object.entries(GIT_TOOLS)) {
            this.tools.set(`local__${name}`, tool);
        }

        // Register testing and command tools
        this.tools.set('local__run_tests', TOOLS.run_tests);
        this.tools.set('local__run_command', TOOLS.run_command);

        // Register file operation tools (critical for agents!)
        this.tools.set('read_file', TOOLS.read_file);
        this.tools.set('write_file', TOOLS.write_file);
        this.tools.set('list_directory', TOOLS.list_directory);
        this.tools.set('search_files', TOOLS.search_files);
        this.tools.set('patch_file', TOOLS.patch_file);
        this.tools.set('delete_file', TOOLS.delete_file);
    }

    /**
     * List all available tools in MCP format
     */
    listTools(): McpTool[] {
        const mcpTools: McpTool[] = [];

        for (const [name, tool] of this.tools.entries()) {
            mcpTools.push({
                name,
                description: tool.description,
                inputSchema: convertParametersToInputSchema(tool.parameters)
            });
        }

        return mcpTools;
    }

    /**
     * Execute a tool and return result in MCP format
     */
    async callTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
        const tool = this.tools.get(name);

        if (!tool) {
            return {
                content: [{
                    type: 'text',
                    text: `Unknown tool: ${name}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`
                }],
                isError: true
            };
        }

        try {
            // Execute the tool with workspace root
            const result = await tool.execute(args, this.workspaceRoot);

            // Convert to MCP format
            return convertToolResultToMcp(result);
        } catch (error: any) {
            return {
                content: [{
                    type: 'text',
                    text: `Tool execution error: ${error.message}`
                }],
                isError: true
            };
        }
    }

    /**
     * Get tool count for logging
     */
    getToolCount(): number {
        return this.tools.size;
    }

    /**
     * Get list of tool names for logging
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }
}

/**
 * Factory function to create local tools server
 */
export function createLocalToolsServer(workspaceRoot: string): LocalToolsServer {
    return new LocalToolsServer(workspaceRoot);
}
