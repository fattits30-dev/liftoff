/**
 * Event Bus Interface
 * Decoupled event system for loose coupling between components
 */

export type EventType =
    // Agent events
    | 'agent:created'
    | 'agent:started'
    | 'agent:completed'
    | 'agent:failed'
    | 'agent:paused'
    | 'agent:resumed'
    | 'agent:cancelled'

    // Task events
    | 'task:created'
    | 'task:started'
    | 'task:progress'
    | 'task:completed'
    | 'task:failed'
    | 'task:retrying'

    // Tool events
    | 'tool:executing'
    | 'tool:completed'
    | 'tool:failed'
    | 'tool:timeout'

    // MCP events
    | 'mcp:server:connected'
    | 'mcp:server:disconnected'
    | 'mcp:server:error'
    | 'mcp:server:health'

    // Memory events
    | 'memory:added'
    | 'memory:updated'
    | 'memory:deleted'

    // Collaboration events
    | 'collab:message'
    | 'collab:handoff'
    | 'collab:spawn'
    | 'collab:complete'

    // UI events
    | 'ui:update'
    | 'ui:log'
    | 'ui:error'
    | 'ui:progress';

export interface EventData<T = unknown> {
    type: EventType;
    payload: T;
    timestamp: Date;
    source?: string;
    correlationId?: string;
}

export type EventHandler<T = unknown> = (data: EventData<T>) => void | Promise<void>;

export interface Subscription {
    unsubscribe(): void;
}

export interface IEventBus {
    /**
     * Emit an event
     */
    emit<T>(type: EventType, payload: T, options?: { source?: string; correlationId?: string }): void;

    /**
     * Subscribe to an event type
     */
    on<T>(type: EventType, handler: EventHandler<T>): Subscription;

    /**
     * Subscribe to an event type (fires once)
     */
    once<T>(type: EventType, handler: EventHandler<T>): Subscription;

    /**
     * Subscribe to multiple event types
     */
    onMany<T>(types: EventType[], handler: EventHandler<T>): Subscription;

    /**
     * Remove all handlers for an event type
     */
    off(type: EventType): void;

    /**
     * Remove all handlers
     */
    clear(): void;

    /**
     * Get count of handlers for an event type
     */
    listenerCount(type: EventType): number;

    /**
     * Wait for an event to occur
     */
    waitFor<T>(type: EventType, timeout?: number): Promise<EventData<T>>;
}
