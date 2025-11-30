/**
 * Sandbox Tools Module [DEPRECATED]
 * This module is deprecated after the migration to direct MCP tools.
 * UnifiedExecutor was removed due to security vulnerabilities.
 * Use MCP tools (local__, filesystem, serena) instead.
 */

import { ToolInfo } from '../../core/interfaces/IToolExecutor';
import { ToolModule, ToolHandler } from './ToolRegistry';
// DEPRECATED: UnifiedExecutor removed due to VM sandbox security vulnerability
// import { UnifiedExecutor } from '../../mcp/unified-executor';

// Type stub for deprecated UnifiedExecutor
class UnifiedExecutor {
    constructor(_workspaceRoot: string, _timeout?: number) {
        throw new Error('UnifiedExecutor is deprecated due to security vulnerabilities. Use MCP tools instead.');
    }
    async execute(_code: string, _timeout?: number): Promise<any> {
        throw new Error('execute() is deprecated. Use MCP tools instead.');
    }
    getSafetyStatus(): any {
        throw new Error('getSafetyStatus() is deprecated. Use MCP tools instead.');
    }
    async createCheckpoint(_name: string): Promise<string> {
        throw new Error('createCheckpoint() is deprecated.');
    }
    async rollback(_checkpoint: string): Promise<boolean> {
        throw new Error('rollback() is deprecated.');
    }
    async dispose(): Promise<void> {}
}

/**
 * Configuration for sandbox tools
 */
export interface SandboxToolsConfig {
    workspaceRoot: string;
    timeout?: number;
}

/**
 * Create a sandbox-based tool module
 * Exposes the execute_code tool that runs arbitrary code in the sandbox
 */
export function createSandboxToolsModule(config: SandboxToolsConfig): ToolModule {
    // DEPRECATED: This function is no longer functional after UnifiedExecutor removal
    // Declare executor to satisfy TypeScript, but throw error immediately
    const executor = new UnifiedExecutor(config.workspaceRoot, config.timeout);

    const tools = new Map<string, {
        info: Omit<ToolInfo, 'source' | 'server'>;
        handler: ToolHandler;
    }>();

    // Main execution tool - runs code in sandbox
    tools.set('execute_code', {
        info: {
            name: 'execute_code',
            description: `Execute JavaScript/TypeScript code with access to sandbox APIs:
- fs.read(path), fs.write(path, content), fs.list(dir), fs.search(pattern)
- shell.run(cmd), shell.runAsync(cmd)
- git.status(), git.diff(), git.commit(msg), git.branch()
- browser.navigate(url), browser.click(sel), browser.screenshot()
- test.discover(), test.run(pattern), test.runFile(file)
- db.detect(), db.prisma(cmd), db.query(sql)
- deploy.dockerfile(), deploy.vercel(), deploy.dockerBuild(tag)
- github.listIssues(), github.createPR(), github.listBranches()
- cicd.generateCI(), cicd.generateVercelDeploy()`,
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'JavaScript/TypeScript code to execute',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Execution timeout in milliseconds',
                    },
                },
                required: ['code'],
            },
        },
        handler: async (args: Record<string, unknown>) => {
            const code = args.code as string;
            const timeout = args.timeout as number | undefined;

            const result = await executor.execute(code, timeout || config.timeout);

            if (!result.success) {
                throw new Error(result.error || 'Execution failed');
            }

            return {
                result: result.result,
                duration: result.duration,
                linesAdded: result.linesAdded,
                linesRemoved: result.linesRemoved,
                filePath: result.filePath,
                screenshot: result.screenshot,
            };
        },
    });

    // Safety status tool
    tools.set('safety_status', {
        info: {
            name: 'safety_status',
            description: 'Get current safety guardrails status including file operation limits',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
        handler: async () => {
            return executor.getSafetyStatus();
        },
    });

    // Create checkpoint tool
    tools.set('create_checkpoint', {
        info: {
            name: 'create_checkpoint',
            description: 'Create a checkpoint of the current workspace state for rollback',
            parameters: {
                type: 'object',
                properties: {
                    description: {
                        type: 'string',
                        description: 'Description of the checkpoint',
                    },
                },
                required: ['description'],
            },
        },
        handler: async (args: Record<string, unknown>) => {
            const description = args.description as string;
            const checkpointId = await executor.createCheckpoint(description);
            return { success: true, checkpointId, message: 'Checkpoint created' };
        },
    });

    // Rollback tool
    tools.set('rollback', {
        info: {
            name: 'rollback',
            description: 'Rollback to a specific checkpoint',
            parameters: {
                type: 'object',
                properties: {
                    checkpointId: {
                        type: 'string',
                        description: 'The checkpoint ID to rollback to',
                    },
                },
                required: ['checkpointId'],
            },
        },
        handler: async (args: Record<string, unknown>) => {
            const checkpointId = args.checkpointId as string;
            const success = await executor.rollback(checkpointId);
            return { success, message: success ? 'Rolled back to checkpoint' : 'Rollback failed' };
        },
    });

    return {
        namespace: 'sandbox',
        tools,
    };
}

/**
 * Convenience methods for common sandbox operations
 */
export class SandboxHelper {
    private executor: UnifiedExecutor;

    constructor(workspaceRoot: string, timeout?: number) {
        // UnifiedExecutor creates its own guardrails internally
        this.executor = new UnifiedExecutor(workspaceRoot, timeout);
    }

    async readFile(path: string): Promise<string> {
        const result = await this.executor.execute(`return await fs.read('${path}')`);
        if (!result.success) throw new Error(result.error);
        return result.result as string;
    }

    async writeFile(path: string, content: string): Promise<string> {
        const escapedContent = content.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const result = await this.executor.execute(`return await fs.write('${path}', \`${escapedContent}\`)`);
        if (!result.success) throw new Error(result.error);
        return result.result as string;
    }

    async runCommand(cmd: string): Promise<string> {
        const result = await this.executor.execute(`return shell.run('${cmd.replace(/'/g, "\\'")}')`);
        if (!result.success) throw new Error(result.error);
        return result.result as string;
    }

    async listFiles(dir: string = '.'): Promise<string[]> {
        const result = await this.executor.execute(`return await fs.list('${dir}')`);
        if (!result.success) throw new Error(result.error);
        return result.result as string[];
    }

    dispose(): void {
        this.executor.dispose();
    }
}
