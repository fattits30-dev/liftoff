/**
 * Composite Memory
 * Unifies multiple memory stores into a single interface
 * Routes operations to appropriate backend stores based on type
 */

import { v4 as _uuidv4 } from 'uuid';
import {
    IMemoryStore,
    MemoryEntry,
    MemoryQuery,
    MemoryType,
    SearchOptions,
} from '../../core/interfaces/IMemoryStore';
import { InMemoryStore } from './InMemoryStore';
import { JsonMemoryStore } from './JsonMemoryStore';
import { IEventBus } from '../../core/interfaces/IEventBus';

/**
 * Configuration for memory type routing
 */
interface MemoryRouteConfig {
    types: MemoryType[];
    store: IMemoryStore;
    name: string;
}

/**
 * Composite Memory - Routes to appropriate stores based on memory type
 */
export class CompositeMemory implements IMemoryStore {
    private routes: MemoryRouteConfig[] = [];
    private defaultStore: IMemoryStore;
    private eventBus?: IEventBus;

    constructor(defaultStore?: IMemoryStore, eventBus?: IEventBus) {
        this.defaultStore = defaultStore || new InMemoryStore();
        this.eventBus = eventBus;
    }

    /**
     * Add a route for specific memory types
     */
    addRoute(name: string, types: MemoryType[], store: IMemoryStore): void {
        this.routes.push({ name, types, store });
    }

    /**
     * Get the store for a memory type
     */
    private getStore(type: MemoryType): IMemoryStore {
        for (const route of this.routes) {
            if (route.types.includes(type)) {
                return route.store;
            }
        }
        return this.defaultStore;
    }

    /**
     * Get all stores that might contain a query's results
     */
    private getStoresForQuery(query: MemoryQuery): IMemoryStore[] {
        if (!query.types || query.types.length === 0) {
            // Query all stores
            const stores = new Set<IMemoryStore>();
            stores.add(this.defaultStore);
            for (const route of this.routes) {
                stores.add(route.store);
            }
            return Array.from(stores);
        }

        // Get stores for specific types
        const stores = new Set<IMemoryStore>();
        for (const type of query.types) {
            stores.add(this.getStore(type));
        }
        return Array.from(stores);
    }

    async add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
        const store = this.getStore(entry.type);
        const id = await store.add(entry);

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('memory:added', {
                id,
                type: entry.type,
                store: this.getStoreName(store),
            });
        }

        return id;
    }

    async get(id: string): Promise<MemoryEntry | null> {
        // Search all stores for the ID
        const stores = new Set<IMemoryStore>();
        stores.add(this.defaultStore);
        for (const route of this.routes) {
            stores.add(route.store);
        }

        for (const store of stores) {
            const entry = await store.get(id);
            if (entry) return entry;
        }

        return null;
    }

    async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
        // Find the entry first
        const entry = await this.get(id);
        if (!entry) {
            throw new Error(`Entry ${id} not found`);
        }

        const store = this.getStore(entry.type);
        await store.update(id, updates);

        if (this.eventBus) {
            this.eventBus.emit('memory:updated', {
                id,
                type: entry.type,
                updates: Object.keys(updates),
            });
        }
    }

    async delete(id: string): Promise<void> {
        // Find the entry first
        const entry = await this.get(id);
        if (!entry) return;

        const store = this.getStore(entry.type);
        await store.delete(id);

        if (this.eventBus) {
            this.eventBus.emit('memory:deleted', {
                id,
                type: entry.type,
            });
        }
    }

    async query(query: MemoryQuery): Promise<MemoryEntry[]> {
        const stores = this.getStoresForQuery(query);

        // Query all relevant stores
        const resultsArrays = await Promise.all(
            stores.map((store) => store.query(query))
        );

        // Merge results
        let results = resultsArrays.flat();

        // Re-sort merged results
        const orderBy = query.orderBy || 'timestamp';
        const orderDir = query.orderDir || 'desc';

        results.sort((a, b) => {
            let cmp: number;
            if (orderBy === 'timestamp') {
                cmp = a.timestamp.getTime() - b.timestamp.getTime();
            } else {
                const importanceOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                const aImp = importanceOrder[a.metadata.importance || 'medium'];
                const bImp = importanceOrder[b.metadata.importance || 'medium'];
                cmp = aImp - bImp;
            }
            return orderDir === 'asc' ? cmp : -cmp;
        });

        // Apply global pagination
        if (query.offset) {
            results = results.slice(query.offset);
        }
        if (query.limit) {
            results = results.slice(0, query.limit);
        }

        return results;
    }

    async search(text: string, options?: SearchOptions): Promise<MemoryEntry[]> {
        const stores = options?.types
            ? this.getStoresForQuery({ types: options.types })
            : this.getAllStores();

        // Search all relevant stores
        const resultsArrays = await Promise.all(
            stores.map((store) => store.search(text, options))
        );

        // Merge and limit
        let results = resultsArrays.flat();

        if (options?.limit) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    async clear(types?: MemoryType[]): Promise<void> {
        if (!types || types.length === 0) {
            // Clear all stores
            const stores = this.getAllStores();
            await Promise.all(stores.map((store) => store.clear()));
        } else {
            // Clear specific types from their stores
            for (const type of types) {
                const store = this.getStore(type);
                await store.clear([type]);
            }
        }
    }

    async count(query?: MemoryQuery): Promise<number> {
        if (!query) {
            // Count all entries across all stores
            const stores = this.getAllStores();
            const counts = await Promise.all(stores.map((store) => store.count()));
            return counts.reduce((sum, c) => sum + c, 0);
        }

        const results = await this.query({ ...query, limit: undefined, offset: undefined });
        return results.length;
    }

    /**
     * Get all unique stores
     */
    private getAllStores(): IMemoryStore[] {
        const stores = new Set<IMemoryStore>();
        stores.add(this.defaultStore);
        for (const route of this.routes) {
            stores.add(route.store);
        }
        return Array.from(stores);
    }

    /**
     * Get the name of a store
     */
    private getStoreName(store: IMemoryStore): string {
        if (store === this.defaultStore) {
            return 'default';
        }
        for (const route of this.routes) {
            if (route.store === store) {
                return route.name;
            }
        }
        return 'unknown';
    }

    /**
     * Get stats about the memory stores
     */
    async getStats(): Promise<{
        totalEntries: number;
        byStore: Record<string, number>;
        byType: Record<string, number>;
    }> {
        const stores = this.getAllStores();
        const byStore: Record<string, number> = {};
        const byType: Record<string, number> = {};

        let totalEntries = 0;

        for (const store of stores) {
            const name = this.getStoreName(store);
            const count = await store.count();
            byStore[name] = count;
            totalEntries += count;
        }

        // Count by type
        const allTypes: MemoryType[] = [
            'action', 'error', 'success', 'plan', 'decision',
            'context', 'lesson', 'session', 'conversation',
        ];

        for (const type of allTypes) {
            const count = await this.count({ types: [type] });
            if (count > 0) {
                byType[type] = count;
            }
        }

        return { totalEntries, byStore, byType };
    }
}

/**
 * Factory to create a pre-configured CompositeMemory
 */
export function createCompositeMemory(
    storagePath: string,
    eventBus?: IEventBus
): CompositeMemory {
    // Default store for transient data
    const inMemoryStore = new InMemoryStore();

    // Persistent store for important data
    const jsonStore = new JsonMemoryStore(`${storagePath}/memory.json`);

    // Create composite
    const composite = new CompositeMemory(inMemoryStore, eventBus);

    // Route persistent types to JSON store
    composite.addRoute('persistent', [
        'lesson',
        'decision',
        'plan',
        'session',
    ], jsonStore);

    return composite;
}
