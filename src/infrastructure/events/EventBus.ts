/**
 * Event Bus Implementation
 * Decoupled event system for loose coupling between components
 */

import { EventEmitter } from 'events';
import {
    IEventBus,
    EventType,
    EventData,
    EventHandler,
    Subscription,
} from '../../core/interfaces/IEventBus';

export class EventBus implements IEventBus {
    private emitter = new EventEmitter();
    private readonly maxListeners = 100;

    constructor() {
        this.emitter.setMaxListeners(this.maxListeners);
    }

    emit<T>(
        type: EventType,
        payload: T,
        options?: { source?: string; correlationId?: string }
    ): void {
        const data: EventData<T> = {
            type,
            payload,
            timestamp: new Date(),
            source: options?.source,
            correlationId: options?.correlationId,
        };

        // Emit specific event
        this.emitter.emit(type, data);

        // Emit wildcard for debugging/logging
        this.emitter.emit('*', data);
    }

    on<T>(type: EventType, handler: EventHandler<T>): Subscription {
        const wrappedHandler = (data: EventData<T>) => {
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in event handler for ${type}:`, error);
            }
        };

        this.emitter.on(type, wrappedHandler);

        return {
            unsubscribe: () => {
                this.emitter.off(type, wrappedHandler);
            },
        };
    }

    once<T>(type: EventType, handler: EventHandler<T>): Subscription {
        const wrappedHandler = (data: EventData<T>) => {
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in once handler for ${type}:`, error);
            }
        };

        this.emitter.once(type, wrappedHandler);

        return {
            unsubscribe: () => {
                this.emitter.off(type, wrappedHandler);
            },
        };
    }

    onMany<T>(types: EventType[], handler: EventHandler<T>): Subscription {
        const subscriptions: Subscription[] = types.map((type) =>
            this.on(type, handler)
        );

        return {
            unsubscribe: () => {
                subscriptions.forEach((sub) => sub.unsubscribe());
            },
        };
    }

    off(type: EventType): void {
        this.emitter.removeAllListeners(type);
    }

    clear(): void {
        this.emitter.removeAllListeners();
    }

    listenerCount(type: EventType): number {
        return this.emitter.listenerCount(type);
    }

    async waitFor<T>(type: EventType, timeout = 30000): Promise<EventData<T>> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.emitter.off(type, handler);
                reject(new Error(`Timeout waiting for event: ${type}`));
            }, timeout);

            const handler = (data: EventData<T>) => {
                clearTimeout(timer);
                resolve(data);
            };

            this.emitter.once(type, handler);
        });
    }

    /**
     * Subscribe to all events (useful for debugging/logging)
     */
    onAll<T>(handler: EventHandler<T>): Subscription {
        this.emitter.on('*', handler);

        return {
            unsubscribe: () => {
                this.emitter.off('*', handler);
            },
        };
    }

    /**
     * Get all registered event types
     */
    getEventTypes(): string[] {
        return this.emitter.eventNames() as string[];
    }
}

// Create a default instance
let defaultEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
    if (!defaultEventBus) {
        defaultEventBus = new EventBus();
    }
    return defaultEventBus;
}

export function setEventBus(eventBus: EventBus): void {
    defaultEventBus = eventBus;
}

export function resetEventBus(): void {
    defaultEventBus?.clear();
    defaultEventBus = null;
}
