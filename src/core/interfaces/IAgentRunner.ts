/**
 * Agent Runner Interface
 * Manages agent lifecycle and execution
 */

import { IToolExecutor, ToolResult } from './IToolExecutor';
import { ILLMProvider, Message } from './ILLMProvider';
import { IMemoryStore } from './IMemoryStore';
import { IEventBus } from './IEventBus';

export type AgentType =
    | 'frontend'
    | 'backend'
    | 'testing'
    | 'browser'
    | 'general'
    | 'cleaner'
    | 'devops'
    | 'database';

export type AgentStatus =
    | 'idle'
    | 'planning'
    | 'executing'
    | 'waiting'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface AgentConfig {
    id: string;
    type: AgentType;
    name: string;
    systemPrompt: string;
    maxIterations?: number;
    maxTokens?: number;
    temperature?: number;
    tools?: string[];  // Tool names this agent can use
}

export interface AgentContext {
    taskId: string;
    projectPath: string;
    workingDirectory: string;
    parentAgentId?: string;
    depth: number;
    maxDepth: number;
    sharedContext?: Record<string, unknown>;
}

export interface AgentResult {
    success: boolean;
    output?: string;
    error?: string;
    iterations: number;
    toolCalls: Array<{
        tool: string;
        args: Record<string, unknown>;
        result: ToolResult;
    }>;
    duration: number;
}

export interface AgentState {
    id: string;
    type: AgentType;
    status: AgentStatus;
    currentTask?: string;
    progress: number;  // 0-100
    iterations: number;
    messages: Message[];
    lastError?: string;
    startTime?: Date;
    endTime?: Date;
}

export interface IAgentRunner {
    /**
     * Dependencies
     */
    readonly toolExecutor: IToolExecutor;
    readonly llmProvider: ILLMProvider;
    readonly memoryStore: IMemoryStore;
    readonly eventBus: IEventBus;

    /**
     * Create a new agent
     */
    create(config: AgentConfig, context: AgentContext): Promise<string>;

    /**
     * Run an agent with a task
     */
    run(agentId: string, task: string): Promise<AgentResult>;

    /**
     * Pause a running agent
     */
    pause(agentId: string): Promise<void>;

    /**
     * Resume a paused agent
     */
    resume(agentId: string): Promise<void>;

    /**
     * Cancel a running agent
     */
    cancel(agentId: string): Promise<void>;

    /**
     * Get agent state
     */
    getState(agentId: string): AgentState | null;

    /**
     * Get all agent states
     */
    getAllStates(): AgentState[];

    /**
     * Destroy an agent
     */
    destroy(agentId: string): Promise<void>;

    /**
     * Destroy all agents
     */
    destroyAll(): Promise<void>;
}
