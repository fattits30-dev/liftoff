/**
 * Tool Registry
 * Composes tool modules into a unified registry
 */

import { IToolExecutor, ToolResult, ToolInfo, ExecutionOptions, BatchResult } from '../../core/interfaces/IToolExecutor';
import { IEventBus } from '../../core/interfaces/IEventBus';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolModule {
    namespace: string;
    tools: Map<string, {
        info: Omit<ToolInfo, 'source' | 'server'>;
        handler: ToolHandler;
    }>;
}

export class ToolRegistry implements IToolExecutor {
    private tools = new Map<string, {
        info: ToolInfo;
        handler: ToolHandler;
    }>();
    private eventBus?: IEventBus;

    constructor(eventBus?: IEventBus) {
        this.eventBus = eventBus;
    }

    /**
     * Register a tool module
     */
    registerModule(module: ToolModule): void {
        for (const [name, { info, handler }] of module.tools) {
            const fullName = `${module.namespace}_${name}`;
            this.tools.set(fullName, {
                info: {
                    ...info,
                    name: fullName,
                    source: 'local',
                },
                handler,
            });
        }
    }

    /**
     * Register a single tool
     */
    registerTool(
        info: ToolInfo,
        handler: ToolHandler
    ): void {
        this.tools.set(info.name, { info, handler });
    }

    /**
     * Unregister a tool
     */
    unregisterTool(name: string): void {
        this.tools.delete(name);
    }

    /**
     * Execute a tool
     */
    async execute(
        name: string,
        args: Record<string, unknown>,
        options?: ExecutionOptions
    ): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                error: `Unknown tool: ${name}`,
            };
        }

        const startTime = Date.now();
        const timeout = options?.timeout ?? 60000;

        try {
            // Execute with timeout
            const result = await Promise.race([
                tool.handler(args),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), timeout)
                ),
            ]);

            const duration = Date.now() - startTime;

            if (this.eventBus) {
                this.eventBus.emit('tool:completed', { name, args, duration });
            }

            return {
                success: true,
                result,
                duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (this.eventBus) {
                this.eventBus.emit('tool:failed', { name, args, error: errorMessage, duration });
            }

            return {
                success: false,
                error: errorMessage,
                duration,
            };
        }
    }

    /**
     * Execute multiple tools in parallel
     */
    async executeBatch(
        calls: Array<{ name: string; args: Record<string, unknown> }>,
        options?: ExecutionOptions
    ): Promise<BatchResult> {
        const startTime = Date.now();
        const results = new Map<string, ToolResult>();
        let failedCount = 0;

        const promises = calls.map(async (call, index) => {
            const result = await this.execute(call.name, call.args, options);
            results.set(`${call.name}:${index}`, result);
            if (!result.success) failedCount++;
        });

        await Promise.all(promises);

        return {
            results,
            duration: Date.now() - startTime,
            failedCount,
        };
    }

    /**
     * List all tools
     */
    async listTools(): Promise<ToolInfo[]> {
        return Array.from(this.tools.values()).map(t => t.info);
    }

    /**
     * Get tool info
     */
    async getToolInfo(name: string): Promise<ToolInfo | null> {
        return this.tools.get(name)?.info ?? null;
    }

    /**
     * Check if tool exists
     */
    async hasTool(name: string): Promise<boolean> {
        return this.tools.has(name);
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        return this.tools.size;
    }

    /**
     * Get tools by namespace
     */
    getToolsByNamespace(namespace: string): ToolInfo[] {
        const prefix = `${namespace}_`;
        return Array.from(this.tools.values())
            .filter(t => t.info.name.startsWith(prefix))
            .map(t => t.info);
    }
}
