/**
 * Agent Message Bus
 * Enables agent-to-agent communication with pub/sub pattern
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
    CollaborationMessage,
    CollaborationMessageType,
    MessagePayload,
    MessagePriority,
} from '../types/collaboration';

type MessageHandler = (message: CollaborationMessage) => void | Promise<void>;

interface Subscription {
    agentId: string;
    types: CollaborationMessageType[];
    handler: MessageHandler;
}

interface PendingRequest {
    resolve: (message: CollaborationMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

/**
 * Message Bus for inter-agent communication
 */
export class AgentMessageBus extends EventEmitter {
    private subscriptions = new Map<string, Subscription[]>();
    private pendingRequests = new Map<string, PendingRequest>();
    private messageHistory: CollaborationMessage[] = [];
    private maxHistorySize = 1000;

    constructor() {
        super();
        this.setMaxListeners(100);
    }

    /**
     * Publish a message to the bus
     */
    publish(message: Omit<CollaborationMessage, 'id' | 'timestamp'>): string {
        const fullMessage: CollaborationMessage = {
            ...message,
            id: uuidv4(),
            timestamp: new Date(),
        };

        // Store in history
        this.addToHistory(fullMessage);

        // Emit for general listeners
        this.emit('message', fullMessage);
        this.emit(`message:${message.type}`, fullMessage);

        // Deliver to specific agent
        if (message.toAgentId) {
            this.deliverTo(message.toAgentId, fullMessage);
        } else {
            // Broadcast to all subscribed agents
            this.broadcast(fullMessage);
        }

        // Check if this is a response to a pending request
        if (message.replyTo) {
            const pending = this.pendingRequests.get(message.replyTo);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(message.replyTo);
                pending.resolve(fullMessage);
            }
        }

        return fullMessage.id;
    }

    /**
     * Subscribe an agent to specific message types
     */
    subscribe(
        agentId: string,
        types: CollaborationMessageType[],
        handler: MessageHandler
    ): () => void {
        const subscription: Subscription = { agentId, types, handler };

        // Add to agent's subscriptions
        const agentSubs = this.subscriptions.get(agentId) || [];
        agentSubs.push(subscription);
        this.subscriptions.set(agentId, agentSubs);

        // Return unsubscribe function
        return () => {
            const subs = this.subscriptions.get(agentId);
            if (subs) {
                const index = subs.indexOf(subscription);
                if (index >= 0) {
                    subs.splice(index, 1);
                }
                if (subs.length === 0) {
                    this.subscriptions.delete(agentId);
                }
            }
        };
    }

    /**
     * Unsubscribe an agent from all messages
     */
    unsubscribe(agentId: string): void {
        this.subscriptions.delete(agentId);
    }

    /**
     * Send a request and wait for response
     */
    async request(
        message: Omit<CollaborationMessage, 'id' | 'timestamp'>,
        timeout = 30000
    ): Promise<CollaborationMessage> {
        return new Promise((resolve, reject) => {
            const messageId = this.publish(message);

            const timer = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new Error(`Request timed out after ${timeout}ms`));
            }, timeout);

            this.pendingRequests.set(messageId, { resolve, reject, timer });
        });
    }

    /**
     * Send a response to a previous message
     */
    reply(
        originalMessage: CollaborationMessage,
        payload: MessagePayload,
        priority?: MessagePriority
    ): string {
        return this.publish({
            type: this.getResponseType(originalMessage.type),
            fromAgentId: originalMessage.toAgentId || 'system',
            toAgentId: originalMessage.fromAgentId,
            payload,
            priority: priority || originalMessage.priority,
            correlationId: originalMessage.correlationId,
            replyTo: originalMessage.id,
        });
    }

    /**
     * Deliver message to a specific agent
     */
    private deliverTo(agentId: string, message: CollaborationMessage): void {
        const subs = this.subscriptions.get(agentId);
        if (!subs) return;

        for (const sub of subs) {
            if (sub.types.includes(message.type) || sub.types.length === 0) {
                this.invokeHandler(sub.handler, message);
            }
        }
    }

    /**
     * Broadcast message to all subscribers
     */
    private broadcast(message: CollaborationMessage): void {
        for (const [agentId, subs] of this.subscriptions) {
            if (agentId === message.fromAgentId) continue; // Don't send to sender

            for (const sub of subs) {
                if (sub.types.includes(message.type) || sub.types.length === 0) {
                    this.invokeHandler(sub.handler, message);
                }
            }
        }
    }

    /**
     * Safely invoke a handler
     */
    private invokeHandler(handler: MessageHandler, message: CollaborationMessage): void {
        try {
            const result = handler(message);
            if (result instanceof Promise) {
                result.catch((err) => {
                    this.emit('error', { message, error: err });
                });
            }
        } catch (err) {
            this.emit('error', { message, error: err });
        }
    }

    /**
     * Get the response type for a message type
     */
    private getResponseType(requestType: CollaborationMessageType): CollaborationMessageType {
        switch (requestType) {
            case 'help_request':
                return 'help_response';
            case 'sub_task':
                return 'sub_complete';
            case 'ping':
                return 'pong';
            default:
                return 'status_update';
        }
    }

    /**
     * Add message to history
     */
    private addToHistory(message: CollaborationMessage): void {
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    /**
     * Get message history
     */
    getHistory(options?: {
        agentId?: string;
        types?: CollaborationMessageType[];
        limit?: number;
        since?: Date;
    }): CollaborationMessage[] {
        let messages = [...this.messageHistory];

        if (options?.agentId) {
            messages = messages.filter(
                (m) => m.fromAgentId === options.agentId || m.toAgentId === options.agentId
            );
        }

        if (options?.types) {
            messages = messages.filter((m) => options.types!.includes(m.type));
        }

        if (options?.since) {
            messages = messages.filter((m) => m.timestamp >= options.since!);
        }

        if (options?.limit) {
            messages = messages.slice(-options.limit);
        }

        return messages;
    }

    /**
     * Get messages between two agents
     */
    getConversation(agentId1: string, agentId2: string): CollaborationMessage[] {
        return this.messageHistory.filter(
            (m) =>
                (m.fromAgentId === agentId1 && m.toAgentId === agentId2) ||
                (m.fromAgentId === agentId2 && m.toAgentId === agentId1)
        );
    }

    /**
     * Get pending requests count
     */
    getPendingCount(): number {
        return this.pendingRequests.size;
    }

    /**
     * Cancel all pending requests
     */
    cancelAllPending(): void {
        for (const [_id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Request cancelled'));
        }
        this.pendingRequests.clear();
    }

    /**
     * Clear all subscriptions and history
     */
    clear(): void {
        this.cancelAllPending();
        this.subscriptions.clear();
        this.messageHistory = [];
        this.removeAllListeners();
    }

    /**
     * Get subscriber count for a message type
     */
    getSubscriberCount(type: CollaborationMessageType): number {
        let count = 0;
        for (const subs of this.subscriptions.values()) {
            for (const sub of subs) {
                if (sub.types.includes(type) || sub.types.length === 0) {
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    /**
     * Get all subscribed agent IDs
     */
    getSubscribedAgents(): string[] {
        return Array.from(this.subscriptions.keys());
    }
}

// Singleton instance
let messageBusInstance: AgentMessageBus | null = null;

export function getMessageBus(): AgentMessageBus {
    if (!messageBusInstance) {
        messageBusInstance = new AgentMessageBus();
    }
    return messageBusInstance;
}

export function resetMessageBus(): void {
    if (messageBusInstance) {
        messageBusInstance.clear();
        messageBusInstance = null;
    }
}
