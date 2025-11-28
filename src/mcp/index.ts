// MCP Module - Model Context Protocol integration for Liftoff
export { McpClient } from './client';
export { McpRouter, getMcpRouter, disposeMcpRouter } from './router';
export * from './types';

// Unified Executor - Single 'execute' tool for 98% token reduction
export { UnifiedExecutor, getUnifiedToolDescription, getExecuteToolSchema } from './unified-executor';

// Default MCP server configurations
export const DEFAULT_MCP_CONFIGS = {
    // Serena - Semantic code analysis
    serena: {
        command: 'python',
        args: ['-m', 'serena'],
        description: 'Semantic code analysis and editing'
    },
    // Filesystem - Basic file operations
    filesystem: {
        command: 'npx',
        args: ['-y', '@anthropic/mcp-server-filesystem'],
        description: 'File system operations'
    },
    // GitHub - Repository operations
    github: {
        command: 'npx',
        args: ['-y', '@anthropic/mcp-server-github'],
        description: 'GitHub repository operations'
    }
};

/**
 * Generate a sample .mcp.json config file
 */
export function generateSampleConfig(workspacePath: string): string {
    return JSON.stringify({
        "$schema": "https://raw.githubusercontent.com/anthropics/mcp/main/schemas/config.json",
        "servers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@anthropic/mcp-server-filesystem", workspacePath],
                "enabled": true
            }
        }
    }, null, 2);
}
