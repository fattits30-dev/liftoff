/**
 * Tool Executor Interface
 * Unified interface for executing tools (MCP or local)
 */

export interface ToolResult {
    success: boolean;
    result?: unknown;
    error?: string;
    duration?: number;
    metadata?: Record<string, unknown>;
}

export interface ToolInfo {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    source: 'local' | 'mcp';
    server?: string;  // MCP server name if source is 'mcp'
}

export interface ExecutionOptions {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    fallbackEnabled?: boolean;
    priority?: 'low' | 'normal' | 'high';
}

export interface BatchResult {
    results: Map<string, ToolResult>;
    duration: number;
    failedCount: number;
}

export interface IToolExecutor {
    /**
     * Execute a single tool
     */
    execute(name: string, args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult>;

    /**
     * Execute multiple tools in parallel
     */
    executeBatch(
        calls: Array<{ name: string; args: Record<string, unknown> }>,
        options?: ExecutionOptions
    ): Promise<BatchResult>;

    /**
     * List all available tools
     */
    listTools(): Promise<ToolInfo[]>;

    /**
     * Get info about a specific tool
     */
    getToolInfo(name: string): Promise<ToolInfo | null>;

    /**
     * Check if a tool exists
     */
    hasTool(name: string): Promise<boolean>;

    /**
     * Register a local tool handler
     */
    registerTool(info: ToolInfo, handler: (args: Record<string, unknown>) => Promise<unknown>): void;

    /**
     * Unregister a tool
     */
    unregisterTool(name: string): void;
}
