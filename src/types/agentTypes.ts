/**
 * Shared types for Agent Management
 * 
 * This provides a unified interface that all agent managers must implement,
 * allowing view providers and other consumers to work with any implementation.
 */

import * as vscode from 'vscode';
import { Artifact } from '../agentCommunication';

export type AgentType = 'frontend' | 'backend' | 'testing' | 'browser' | 'general' | 'cleaner';
export type AgentStatus = 'idle' | 'running' | 'waiting_user' | 'completed' | 'error' | 'stopped';

/**
 * Base agent interface - what every agent looks like
 */
export interface IAgent {
    id: string;
    type: AgentType;
    status: AgentStatus;
    name: string;
    task: string;
    iterations: number;
    artifacts: Artifact[];
    startTime: Date;
    endTime?: Date;
}

/**
 * Configuration for spawning a new agent
 */
export interface AgentSpawnConfig {
    type: AgentType;
    task: string;
    model?: string;
    maxIterations?: number;
}

/**
 * Output event data
 */
export interface AgentOutputEvent {
    agentId: string;
    content: string;
    type?: 'thought' | 'tool' | 'result' | 'error';
}

/**
 * Core interface that all agent managers must implement
 * View providers and other consumers should depend on this interface
 */
export interface IAgentManager extends vscode.Disposable {
    // Event subscriptions
    readonly onAgentUpdate: vscode.Event<IAgent>;
    readonly onAgentOutput: vscode.Event<AgentOutputEvent>;
    readonly onToolStart: vscode.Event<{ tool: string; params: Record<string, unknown> }>;
    readonly onToolComplete: vscode.Event<{ tool: string; success: boolean; output: string; duration: number }>;

    // Legacy event subscription (for backwards compatibility)
    on(event: 'agentUpdate' | 'agentSpawned' | 'statusChange', callback: (agent: IAgent) => void): vscode.Disposable;
    on(event: 'agentOutput' | 'output', callback: (data: AgentOutputEvent) => void): vscode.Disposable;
    on(event: 'newArtifact', callback: (artifact: Artifact) => void): vscode.Disposable;
    
    // Agent lifecycle
    spawnAgent(config: AgentSpawnConfig): Promise<IAgent>;
    continueAgent(agentId: string, message: string): Promise<void>;
    stopAgent(agentId: string): void;
    killAgent(agentId: string): void;  // Alias for stopAgent
    stopAllAgents(): void;
    removeAgent(agentId: string): void;
    
    // Agent queries
    getAgent(id: string): IAgent | undefined;
    getAllAgents(): IAgent[];
    getRunningAgents(): IAgent[];
    getAllArtifacts(): Artifact[];
    
    // Configuration
    setApiKey(apiKey: string): void;
    
    // Connection testing
    testConnection(): Promise<boolean>;
    
    // Output
    showOutput(): void;
}

/**
 * Model configuration constants
 * Centralizes all model names to make updates easier when HuggingFace changes things
 */
export const MODEL_CONFIG = {
    // Cloud models (HuggingFace Inference API)
    cloud: {
        default: 'deepseek-ai/DeepSeek-V3-0324',
        fallbacks: [
            'Qwen/Qwen2.5-Coder-32B-Instruct',
            'Qwen/Qwen2.5-Coder-14B-Instruct',
            'Qwen/Qwen2.5-Coder-7B-Instruct',
        ],
        // Named aliases for easier selection
        aliases: {
            'qwen3-coder': 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
            'qwen-32b': 'Qwen/Qwen2.5-Coder-32B-Instruct',
            'qwen-14b': 'Qwen/Qwen2.5-Coder-14B-Instruct',
            'qwen-7b': 'Qwen/Qwen2.5-Coder-7B-Instruct',
            'deepseek-v3': 'deepseek-ai/DeepSeek-V3-0324',
            'deepseek-r1': 'deepseek-ai/DeepSeek-R1',
            'llama-70b': 'meta-llama/Llama-3.3-70B-Instruct',
        } as Record<string, string>,
    },
    // Timeouts and limits
    limits: {
        maxTokens: 4096,
        maxIterations: 100,
        defaultTimeout: 300000,  // 5 minutes
        testTimeout: 180000,     // 3 minutes for tests
        commandTimeout: 120000,  // 2 minutes for shell commands
    },
} as const;

/**
 * Resolve a model alias to full model name
 */
export function resolveModelName(modelOrAlias: string): string {
    if (modelOrAlias.includes('/')) {
        // Already a full model name
        return modelOrAlias;
    }
    return MODEL_CONFIG.cloud.aliases[modelOrAlias] || modelOrAlias;
}
