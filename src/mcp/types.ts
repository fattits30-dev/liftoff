// MCP (Model Context Protocol) Type Definitions
// Based on the MCP specification for tool calling

// JSON-RPC 2.0 base types
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: Record<string, any>;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: any;
    error?: JsonRpcError;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: any;
}

// MCP Tool types - lenient to handle different server implementations
export interface McpTool {
    name: string;
    description: string;
    inputSchema: {
        type?: string; // Usually 'object' but some servers omit this
        properties?: Record<string, {
            type?: string;
            description?: string;
            enum?: string[];
            default?: any;
            [key: string]: any; // Allow additional properties
        }>;
        required?: string[];
        [key: string]: any; // Allow additional schema properties
    };
}

export interface McpToolCall {
    name: string;
    arguments: Record<string, any>;
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

// MCP Server capabilities
export interface McpServerCapabilities {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
}

export interface McpClientCapabilities {
    roots?: { listChanged?: boolean };
    sampling?: {};
}

// MCP Initialize
export interface McpInitializeParams {
    protocolVersion: string;
    capabilities: McpClientCapabilities;
    clientInfo: {
        name: string;
        version: string;
    };
}

export interface McpInitializeResult {
    protocolVersion: string;
    capabilities: McpServerCapabilities;
    serverInfo: {
        name: string;
        version: string;
    };
}

// MCP Server Configuration
export interface McpServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    enabled?: boolean;
}

// Liftoff-specific types
export interface ConnectedServer {
    config: McpServerConfig;
    tools: McpTool[];
    status: 'connecting' | 'ready' | 'error' | 'disconnected';
    error?: string;
}

export interface ToolCallResult {
    success: boolean;
    output: string;
    error?: string;
    server?: string;
    duration?: number;  // Execution time in ms
}
