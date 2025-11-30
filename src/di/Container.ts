/**
 * Simple Dependency Injection Container
 * Lightweight DI without external dependencies
 */

export type Factory<T> = () => T;
export type AsyncFactory<T> = () => Promise<T>;

interface Registration<T> {
    factory: Factory<T> | AsyncFactory<T>;
    singleton: boolean;
    instance?: T;
    async: boolean;
}

export class Container {
    private registrations = new Map<symbol, Registration<unknown>>();
    private resolving = new Set<symbol>();  // Circular dependency detection

    /**
     * Register a factory for a token (transient by default)
     */
    register<T>(token: symbol, factory: Factory<T>): this {
        this.registrations.set(token, {
            factory,
            singleton: false,
            async: false,
        });
        return this;
    }

    /**
     * Register a singleton factory
     */
    registerSingleton<T>(token: symbol, factory: Factory<T>): this {
        this.registrations.set(token, {
            factory,
            singleton: true,
            async: false,
        });
        return this;
    }

    /**
     * Register an async factory
     */
    registerAsync<T>(token: symbol, factory: AsyncFactory<T>): this {
        this.registrations.set(token, {
            factory,
            singleton: false,
            async: true,
        });
        return this;
    }

    /**
     * Register an async singleton factory
     */
    registerAsyncSingleton<T>(token: symbol, factory: AsyncFactory<T>): this {
        this.registrations.set(token, {
            factory,
            singleton: true,
            async: true,
        });
        return this;
    }

    /**
     * Register a pre-created instance
     */
    registerInstance<T>(token: symbol, instance: T): this {
        this.registrations.set(token, {
            factory: () => instance,
            singleton: true,
            instance,
            async: false,
        });
        return this;
    }

    /**
     * Resolve a dependency synchronously
     */
    resolve<T>(token: symbol): T {
        const registration = this.registrations.get(token);
        if (!registration) {
            throw new Error(`No registration found for token: ${token.toString()}`);
        }

        if (registration.async) {
            throw new Error(`Token ${token.toString()} requires async resolution. Use resolveAsync() instead.`);
        }

        // Return cached singleton
        if (registration.singleton && registration.instance !== undefined) {
            return registration.instance as T;
        }

        // Circular dependency check
        if (this.resolving.has(token)) {
            throw new Error(`Circular dependency detected for token: ${token.toString()}`);
        }

        this.resolving.add(token);
        try {
            const instance = (registration.factory as Factory<T>)();

            if (registration.singleton) {
                registration.instance = instance;
            }

            return instance;
        } finally {
            this.resolving.delete(token);
        }
    }

    /**
     * Resolve a dependency asynchronously
     */
    async resolveAsync<T>(token: symbol): Promise<T> {
        const registration = this.registrations.get(token);
        if (!registration) {
            throw new Error(`No registration found for token: ${token.toString()}`);
        }

        // Return cached singleton
        if (registration.singleton && registration.instance !== undefined) {
            return registration.instance as T;
        }

        // Circular dependency check
        if (this.resolving.has(token)) {
            throw new Error(`Circular dependency detected for token: ${token.toString()}`);
        }

        this.resolving.add(token);
        try {
            let instance: T;
            if (registration.async) {
                instance = await (registration.factory as AsyncFactory<T>)();
            } else {
                instance = (registration.factory as Factory<T>)();
            }

            if (registration.singleton) {
                registration.instance = instance;
            }

            return instance;
        } finally {
            this.resolving.delete(token);
        }
    }

    /**
     * Check if a token is registered
     */
    has(token: symbol): boolean {
        return this.registrations.has(token);
    }

    /**
     * Unregister a token
     */
    unregister(token: symbol): boolean {
        return this.registrations.delete(token);
    }

    /**
     * Clear all registrations
     */
    clear(): void {
        this.registrations.clear();
        this.resolving.clear();
    }

    /**
     * Create a child container that inherits parent registrations
     */
    createChild(): Container {
        const child = new Container();
        for (const [token, registration] of this.registrations) {
            child.registrations.set(token, { ...registration });
        }
        return child;
    }

    /**
     * Get all registered tokens
     */
    getTokens(): symbol[] {
        return Array.from(this.registrations.keys());
    }
}

// Global container instance
let globalContainer: Container | null = null;

export function getContainer(): Container {
    if (!globalContainer) {
        globalContainer = new Container();
    }
    return globalContainer;
}

export function setContainer(container: Container): void {
    globalContainer = container;
}

export function resetContainer(): void {
    globalContainer?.clear();
    globalContainer = null;
}
