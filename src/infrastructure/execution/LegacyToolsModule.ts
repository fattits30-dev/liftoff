/**
 * Legacy Tools Module
 * Adapts the existing TOOLS record to the new ToolModule interface
 */

import { ToolInfo } from '../../core/interfaces/IToolExecutor';
import { ToolModule, ToolHandler } from './ToolRegistry';
import { TOOLS, Tool } from '../../tools';

/**
 * Convert a legacy Tool to the new format
 */
function convertTool(tool: Tool, workspaceRoot: string): {
    info: Omit<ToolInfo, 'source' | 'server'>;
    handler: ToolHandler;
} {
    // Build JSON schema from parameters
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
        properties[name] = {
            type: param.type,
            description: param.description,
        };
        if (param.required) {
            required.push(name);
        }
    }

    return {
        info: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            },
        },
        handler: async (args: Record<string, unknown>) => {
            const result = await tool.execute(args as Record<string, unknown>, workspaceRoot);
            if (!result.success) {
                throw new Error(result.error || 'Tool execution failed');
            }
            return result.output;
        },
    };
}

/**
 * Create a ToolModule from legacy TOOLS
 */
export function createLegacyToolsModule(workspaceRoot: string): ToolModule {
    const tools = new Map<string, {
        info: Omit<ToolInfo, 'source' | 'server'>;
        handler: ToolHandler;
    }>();

    for (const [name, tool] of Object.entries(TOOLS)) {
        tools.set(name, convertTool(tool, workspaceRoot));
    }

    return {
        namespace: 'legacy',
        tools,
    };
}

/**
 * Tool categories for documentation
 */
export const LEGACY_TOOL_CATEGORIES = {
    file: ['read_file', 'write_file', 'patch_file', 'delete_file', 'list_directory', 'search_files'],
    shell: ['run_command'],
    test: ['run_tests'],
} as const;
