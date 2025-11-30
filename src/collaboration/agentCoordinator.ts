/**
 * Agent Coordinator
 * Manages agent spawning, handoffs, and intelligent retry strategies
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentType } from '../core/interfaces/IAgentRunner';
import { IEventBus } from '../core/interfaces/IEventBus';
import { AgentMessageBus, getMessageBus } from './messageBus';
import { RetryAnalyzer } from './retryAnalyzer';
import {
    CollaborationMessage,
    HierarchicalAgent,
    HierarchyConstraints,
    DEFAULT_HIERARCHY_CONSTRAINTS,
    RetryDecision,
    FailedAttempt,
    SubTaskPayload,
    HandoffPayload,
    HelpRequestPayload,
    AGENT_CAPABILITIES,
} from '../types/collaboration';

export interface AgentCoordinatorConfig {
    eventBus?: IEventBus;
    messageBus?: AgentMessageBus;
    hierarchyConstraints?: HierarchyConstraints;
}

interface ManagedAgent {
    agent: HierarchicalAgent;
    failedAttempts: FailedAttempt[];
    createdAt: Date;
    lastActivity: Date;
}

/**
 * Coordinates agent spawning, handoffs, and collaboration
 */
export class AgentCoordinator {
    private messageBus: AgentMessageBus;
    private retryAnalyzer: RetryAnalyzer;
    private eventBus?: IEventBus;
    private constraints: HierarchyConstraints;

    private agents = new Map<string, ManagedAgent>();
    private taskAgentMap = new Map<string, string>(); // taskId -> agentId

    constructor(config?: AgentCoordinatorConfig) {
        this.messageBus = config?.messageBus || getMessageBus();
        this.retryAnalyzer = new RetryAnalyzer();
        this.eventBus = config?.eventBus;
        this.constraints = config?.hierarchyConstraints || DEFAULT_HIERARCHY_CONSTRAINTS;

        this.setupMessageHandlers();
    }

    /**
     * Set up message bus handlers
     */
    private setupMessageHandlers(): void {
        // Handle help requests
        this.messageBus.on('message:help_request', (message: CollaborationMessage) => {
            this.handleHelpRequest(message);
        });

        // Handle handoffs
        this.messageBus.on('message:handoff', (message: CollaborationMessage) => {
            this.handleHandoff(message);
        });

        // Handle sub-task completions
        this.messageBus.on('message:sub_complete', (message: CollaborationMessage) => {
            this.handleSubTaskComplete(message);
        });

        // Handle status updates
        this.messageBus.on('message:status_update', (message: CollaborationMessage) => {
            this.handleStatusUpdate(message);
        });
    }

    /**
     * Register an agent with the coordinator
     */
    registerAgent(agent: HierarchicalAgent): void {
        this.agents.set(agent.id, {
            agent,
            failedAttempts: [],
            createdAt: new Date(),
            lastActivity: new Date(),
        });

        // Subscribe agent to messages
        this.messageBus.subscribe(agent.id, [], (_message) => {
            // Agent handles its own messages
        });

        this.emitEvent('collab:spawn', {
            agentId: agent.id,
            type: agent.type,
            parentId: agent.parentId,
        });
    }

    /**
     * Unregister an agent
     */
    unregisterAgent(agentId: string): void {
        const managed = this.agents.get(agentId);
        if (!managed) return;

        // Remove children first
        for (const childId of managed.agent.childIds) {
            this.unregisterAgent(childId);
        }

        // Unsubscribe from messages
        this.messageBus.unsubscribe(agentId);

        // Remove from parent's children list
        if (managed.agent.parentId) {
            const parent = this.agents.get(managed.agent.parentId);
            if (parent) {
                const index = parent.agent.childIds.indexOf(agentId);
                if (index >= 0) {
                    parent.agent.childIds.splice(index, 1);
                }
            }
        }

        this.agents.delete(agentId);
    }

    /**
     * Spawn a sub-agent for a parent
     */
    async spawnSubAgent(
        parentId: string,
        task: string,
        agentType: AgentType,
        options?: {
            maxIterations?: number;
            timeout?: number;
            allowedTools?: string[];
        }
    ): Promise<HierarchicalAgent | null> {
        const parent = this.agents.get(parentId);
        if (!parent) {
            throw new Error(`Parent agent ${parentId} not found`);
        }

        // Check hierarchy constraints
        if (parent.agent.depth >= this.constraints.maxDepth) {
            this.emitEvent('collab:spawn', {
                agentId: parentId,
                error: 'Max depth exceeded',
            });
            return null;
        }

        if (parent.agent.childIds.length >= this.constraints.maxChildren) {
            this.emitEvent('collab:spawn', {
                agentId: parentId,
                error: 'Max children exceeded',
            });
            return null;
        }

        if (this.agents.size >= this.constraints.maxTotalAgents) {
            this.emitEvent('collab:spawn', {
                agentId: parentId,
                error: 'Max total agents exceeded',
            });
            return null;
        }

        // Create sub-agent
        const subAgent: HierarchicalAgent = {
            id: uuidv4(),
            type: agentType,
            name: `${agentType}-${Date.now()}`,
            parentId,
            childIds: [],
            depth: parent.agent.depth + 1,
            maxDepth: this.constraints.maxDepth,
            status: 'idle',
        };

        // Register and link to parent
        this.registerAgent(subAgent);
        parent.agent.childIds.push(subAgent.id);

        // Publish sub-task message
        this.messageBus.publish({
            type: 'sub_task',
            fromAgentId: parentId,
            toAgentId: subAgent.id,
            payload: {
                type: 'sub_task',
                task,
                context: '',
                agentType,
                parentTaskId: parentId,
                constraints: options,
            } as SubTaskPayload,
            priority: 'normal',
        });

        return subAgent;
    }

    /**
     * Handle handoff request
     */
    async handoff(
        fromAgentId: string,
        toAgentType: AgentType,
        task: string,
        context: string,
        reason: string
    ): Promise<string | null> {
        const fromAgent = this.agents.get(fromAgentId);
        if (!fromAgent) {
            throw new Error(`Agent ${fromAgentId} not found`);
        }

        // Find or create target agent
        let targetAgent = this.findAvailableAgent(toAgentType);

        if (!targetAgent) {
            // Create new agent at same level
            const parent = fromAgent.agent.parentId
                ? this.agents.get(fromAgent.agent.parentId)
                : null;

            targetAgent = {
                id: uuidv4(),
                type: toAgentType,
                name: `${toAgentType}-${Date.now()}`,
                parentId: parent?.agent.id,
                childIds: [],
                depth: fromAgent.agent.depth,
                maxDepth: this.constraints.maxDepth,
                status: 'idle',
            };

            this.registerAgent(targetAgent);
        }

        // Publish handoff message
        this.messageBus.publish({
            type: 'handoff',
            fromAgentId,
            toAgentId: targetAgent.id,
            payload: {
                type: 'handoff',
                task,
                context,
                targetAgentType: toAgentType,
                reason,
            } as HandoffPayload,
            priority: 'high',
        });

        this.emitEvent('collab:handoff', {
            from: fromAgentId,
            to: targetAgent.id,
            task,
            reason,
        });

        return targetAgent.id;
    }

    /**
     * Analyze failure and get retry decision
     */
    analyzeFailure(agentId: string, error: string): RetryDecision {
        const managed = this.agents.get(agentId);
        if (!managed) {
            return {
                strategy: 'escalate',
                reason: 'Agent not found',
                confidence: 0,
            };
        }

        return this.retryAnalyzer.analyze(
            managed.agent.type,
            error,
            managed.failedAttempts
        );
    }

    /**
     * Record a failed attempt for an agent
     */
    recordFailedAttempt(agentId: string, attempt: Omit<FailedAttempt, 'agentId'>): void {
        const managed = this.agents.get(agentId);
        if (!managed) return;

        managed.failedAttempts.push({
            ...attempt,
            agentId,
        });

        managed.lastActivity = new Date();
    }

    /**
     * Route a collaboration message
     */
    async routeMessage(message: CollaborationMessage): Promise<void> {
        // Update activity timestamp
        const sender = this.agents.get(message.fromAgentId);
        if (sender) {
            sender.lastActivity = new Date();
        }

        // Publish to message bus
        this.messageBus.publish(message);
    }

    /**
     * Handle help request
     */
    private handleHelpRequest(message: CollaborationMessage): void {
        const payload = message.payload as HelpRequestPayload;

        // Find best agent to help
        const helper = this.findBestHelper(
            message.fromAgentId,
            payload.requiredCapabilities || []
        );

        if (helper) {
            // Forward request to helper
            this.messageBus.publish({
                ...message,
                toAgentId: helper.id,
            });
        } else {
            // No helper available, respond with rejection
            this.messageBus.reply(message, {
                type: 'help_response',
                accepted: false,
                reason: 'No suitable helper available',
                suggestions: this.getSuggestions(payload),
            });
        }
    }

    /**
     * Handle handoff
     */
    private handleHandoff(message: CollaborationMessage): void {
        const payload = message.payload as HandoffPayload;

        // Update sender status
        const sender = this.agents.get(message.fromAgentId);
        if (sender) {
            sender.agent.status = 'idle';
        }

        // Update receiver status
        const receiver = this.agents.get(message.toAgentId || '');
        if (receiver) {
            receiver.agent.status = 'executing';
        }

        this.emitEvent('collab:handoff', {
            from: message.fromAgentId,
            to: message.toAgentId,
            task: payload.task,
        });
    }

    /**
     * Handle sub-task completion
     */
    private handleSubTaskComplete(message: CollaborationMessage): void {
        // Find parent and notify
        const child = this.agents.get(message.fromAgentId);
        if (child?.agent.parentId) {
            const parent = this.agents.get(child.agent.parentId);
            if (parent) {
                parent.lastActivity = new Date();
            }
        }

        this.emitEvent('collab:complete', {
            agentId: message.fromAgentId,
            payload: message.payload,
        });
    }

    /**
     * Handle status update
     */
    private handleStatusUpdate(message: CollaborationMessage): void {
        const managed = this.agents.get(message.fromAgentId);
        if (managed) {
            managed.lastActivity = new Date();
        }
    }

    /**
     * Find an available agent of a specific type
     */
    private findAvailableAgent(type: AgentType): HierarchicalAgent | null {
        for (const managed of this.agents.values()) {
            if (managed.agent.type === type && managed.agent.status === 'idle') {
                return managed.agent;
            }
        }
        return null;
    }

    /**
     * Find the best agent to help with a request
     */
    private findBestHelper(
        excludeId: string,
        requiredCapabilities: AgentType[]
    ): HierarchicalAgent | null {
        let bestAgent: HierarchicalAgent | null = null;
        let bestScore = -1;

        for (const managed of this.agents.values()) {
            if (managed.agent.id === excludeId) continue;
            if (managed.agent.status !== 'idle') continue;

            let score = 0;

            // Prefer agents with required capabilities
            if (requiredCapabilities.includes(managed.agent.type)) {
                score += 100;
            }

            // Prefer agents with higher capability priority
            const capability = AGENT_CAPABILITIES.find(
                (c) => c.agentType === managed.agent.type
            );
            if (capability) {
                score += capability.priority;
            }

            // Prefer agents with fewer failed attempts
            score -= managed.failedAttempts.length * 10;

            if (score > bestScore) {
                bestScore = score;
                bestAgent = managed.agent;
            }
        }

        return bestAgent;
    }

    /**
     * Get suggestions for a failed help request
     */
    private getSuggestions(payload: HelpRequestPayload): string[] {
        const suggestions: string[] = [];

        suggestions.push('Consider breaking down the task into smaller subtasks');
        suggestions.push('Try a different approach to the problem');

        if (payload.requiredCapabilities) {
            suggestions.push(
                `Required capabilities: ${payload.requiredCapabilities.join(', ')}`
            );
        }

        return suggestions;
    }

    /**
     * Emit event to event bus
     */
    private emitEvent(type: 'collab:spawn' | 'collab:handoff' | 'collab:complete' | 'collab:message', payload: unknown): void {
        if (this.eventBus) {
            this.eventBus.emit(type, payload, { source: 'AgentCoordinator' });
        }
    }

    /**
     * Get agent by ID
     */
    getAgent(agentId: string): HierarchicalAgent | null {
        return this.agents.get(agentId)?.agent ?? null;
    }

    /**
     * Get all agents
     */
    getAllAgents(): HierarchicalAgent[] {
        return Array.from(this.agents.values()).map((m) => m.agent);
    }

    /**
     * Get agent hierarchy as tree
     */
    getHierarchyTree(): Map<string, string[]> {
        const tree = new Map<string, string[]>();

        for (const managed of this.agents.values()) {
            tree.set(managed.agent.id, [...managed.agent.childIds]);
        }

        return tree;
    }

    /**
     * Get root agents (no parent)
     */
    getRootAgents(): HierarchicalAgent[] {
        return Array.from(this.agents.values())
            .filter((m) => !m.agent.parentId)
            .map((m) => m.agent);
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalAgents: number;
        byType: Record<AgentType, number>;
        byStatus: Record<string, number>;
        totalFailedAttempts: number;
    } {
        const byType: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        let totalFailedAttempts = 0;

        for (const managed of this.agents.values()) {
            byType[managed.agent.type] = (byType[managed.agent.type] || 0) + 1;
            byStatus[managed.agent.status] = (byStatus[managed.agent.status] || 0) + 1;
            totalFailedAttempts += managed.failedAttempts.length;
        }

        return {
            totalAgents: this.agents.size,
            byType: byType as Record<AgentType, number>,
            byStatus,
            totalFailedAttempts,
        };
    }

    /**
     * Clear all agents
     */
    clear(): void {
        for (const agentId of Array.from(this.agents.keys())) {
            this.unregisterAgent(agentId);
        }
        this.taskAgentMap.clear();
    }
}
