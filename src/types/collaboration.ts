/**
 * Collaboration Types
 * Types for agent-to-agent communication and hierarchical sub-agents
 */

import { AgentType, AgentStatus } from '../core/interfaces/IAgentRunner';

/**
 * Message types for agent collaboration
 */
export type CollaborationMessageType =
    | 'help_request'    // Agent asks another for help
    | 'help_response'   // Response to help request
    | 'handoff'         // Transfer task to another agent
    | 'sub_task'        // Spawn sub-agent with task
    | 'sub_complete'    // Sub-agent completed
    | 'sub_failed'      // Sub-agent failed
    | 'context_share'   // Share context between agents
    | 'status_update'   // Agent status update
    | 'ping'            // Health check
    | 'pong';           // Health check response

/**
 * Priority levels for messages
 */
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Collaboration message structure
 */
export interface CollaborationMessage {
    id: string;
    type: CollaborationMessageType;
    fromAgentId: string;
    toAgentId?: string;  // Undefined = broadcast
    payload: MessagePayload;
    priority: MessagePriority;
    timestamp: Date;
    correlationId?: string;  // For request/response pairing
    replyTo?: string;  // Message ID this is replying to
    ttl?: number;  // Time to live in ms
}

/**
 * Message payloads by type
 */
export type MessagePayload =
    | HelpRequestPayload
    | HelpResponsePayload
    | HandoffPayload
    | SubTaskPayload
    | SubCompletePayload
    | ContextSharePayload
    | StatusUpdatePayload
    | PingPongPayload;

export interface HelpRequestPayload {
    type: 'help_request';
    task: string;
    context: string;
    requiredCapabilities?: AgentType[];
    urgency: MessagePriority;
}

export interface HelpResponsePayload {
    type: 'help_response';
    accepted: boolean;
    reason?: string;
    response?: string;
    suggestions?: string[];
}

export interface HandoffPayload {
    type: 'handoff';
    task: string;
    context: string;
    targetAgentType: AgentType;
    reason: string;
    conversationHistory?: Array<{ role: string; content: string }>;
}

export interface SubTaskPayload {
    type: 'sub_task';
    task: string;
    context: string;
    agentType: AgentType;
    parentTaskId: string;
    constraints?: {
        maxIterations?: number;
        timeout?: number;
        allowedTools?: string[];
    };
}

export interface SubCompletePayload {
    type: 'sub_complete';
    taskId: string;
    success: boolean;
    result?: string;
    error?: string;
    duration: number;
    toolsUsed: string[];
}

export interface ContextSharePayload {
    type: 'context_share';
    contextKey: string;
    contextValue: unknown;
    scope: 'task' | 'session' | 'global';
}

export interface StatusUpdatePayload {
    type: 'status_update';
    status: AgentStatus;
    progress: number;
    currentAction?: string;
}

export interface PingPongPayload {
    type: 'ping' | 'pong';
    timestamp: number;
}

/**
 * Hierarchical agent structure
 */
export interface HierarchicalAgent {
    id: string;
    type: AgentType;
    name: string;
    parentId?: string;
    childIds: string[];
    depth: number;
    maxDepth: number;
    status: AgentStatus;
}

/**
 * Agent hierarchy constraints
 */
export interface HierarchyConstraints {
    maxDepth: number;  // Maximum nesting level
    maxChildren: number;  // Maximum children per agent
    maxTotalAgents: number;  // Maximum total agents in hierarchy
}

/**
 * Default hierarchy constraints
 */
export const DEFAULT_HIERARCHY_CONSTRAINTS: HierarchyConstraints = {
    maxDepth: 2,
    maxChildren: 3,
    maxTotalAgents: 10,
};

/**
 * Agent capability declaration
 */
export interface AgentCapability {
    agentType: AgentType;
    skills: string[];
    tools: string[];
    languages?: string[];
    frameworks?: string[];
    priority: number;  // Higher = more preferred for matching tasks
}

/**
 * Default agent capabilities
 */
export const AGENT_CAPABILITIES: AgentCapability[] = [
    {
        agentType: 'frontend',
        skills: ['ui', 'styling', 'components', 'react', 'vue', 'css', 'html'],
        tools: ['local_fs_read', 'local_fs_write', 'local_shell_run'],
        frameworks: ['react', 'vue', 'angular', 'svelte'],
        priority: 80,
    },
    {
        agentType: 'backend',
        skills: ['api', 'database', 'server', 'authentication', 'business-logic'],
        tools: ['local_fs_read', 'local_fs_write', 'local_shell_run', 'local_test_run'],
        frameworks: ['express', 'fastapi', 'django', 'nest'],
        priority: 80,
    },
    {
        agentType: 'testing',
        skills: ['tests', 'quality', 'coverage', 'debugging', 'verification'],
        tools: ['local_test_run', 'local_test_discover', 'local_fs_read'],
        frameworks: ['jest', 'vitest', 'pytest', 'playwright'],
        priority: 70,
    },
    {
        agentType: 'browser',
        skills: ['web-automation', 'screenshot', 'e2e', 'scraping'],
        tools: ['browser_navigate', 'browser_click', 'browser_screenshot'],
        priority: 60,
    },
    {
        agentType: 'devops',
        skills: ['deployment', 'ci-cd', 'docker', 'kubernetes', 'cloud'],
        tools: ['local_shell_run', 'local_fs_write'],
        priority: 70,
    },
    {
        agentType: 'database',
        skills: ['sql', 'migrations', 'schema', 'queries', 'optimization'],
        tools: ['local_shell_run', 'local_fs_read', 'local_fs_write'],
        priority: 75,
    },
    {
        agentType: 'general',
        skills: ['research', 'planning', 'coordination', 'documentation'],
        tools: ['local_fs_read', 'local_fs_write', 'local_shell_run'],
        priority: 50,
    },
    {
        agentType: 'cleaner',
        skills: ['refactoring', 'cleanup', 'optimization', 'linting'],
        tools: ['local_fs_read', 'local_fs_write', 'local_shell_run'],
        priority: 40,
    },
];

/**
 * Retry strategies for failed operations
 */
export type RetryStrategy =
    | 'same_agent'           // Retry with same agent, same approach
    | 'same_agent_different' // Same agent, different approach
    | 'different_agent'      // Hand off to different agent type
    | 'spawn_helper'         // Spawn sub-agent to help
    | 'decompose'            // Break task into subtasks
    | 'escalate';            // Return to user for help

/**
 * Retry decision from analyzer
 */
export interface RetryDecision {
    strategy: RetryStrategy;
    targetAgent?: AgentType;
    modifiedPrompt?: string;
    subtasks?: string[];
    reason: string;
    confidence: number;  // 0-1
}

/**
 * Failed attempt record
 */
export interface FailedAttempt {
    agentId: string;
    agentType: AgentType;
    task: string;
    error: string;
    timestamp: Date;
    duration: number;
    toolsAttempted: string[];
    iterationsUsed: number;
}

/**
 * Task decomposition result
 */
export interface TaskDecomposition {
    originalTask: string;
    subtasks: Array<{
        task: string;
        agentType: AgentType;
        priority: number;
        dependencies: number[];  // Indices of subtasks this depends on
    }>;
    estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Collaboration event for logging/debugging
 */
export interface CollaborationEvent {
    id: string;
    type: 'message_sent' | 'message_received' | 'agent_spawned' | 'handoff' | 'retry';
    timestamp: Date;
    agentId: string;
    details: Record<string, unknown>;
}
