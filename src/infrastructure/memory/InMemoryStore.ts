/**
 * In-Memory Store
 * Simple in-memory implementation of IMemoryStore for testing and transient data
 */

import { v4 as uuidv4 } from 'uuid';
import {
    IMemoryStore,
    MemoryEntry,
    MemoryQuery,
    MemoryType,
    SearchOptions,
} from '../../core/interfaces/IMemoryStore';

export class InMemoryStore implements IMemoryStore {
    private entries = new Map<string, MemoryEntry>();

    async add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
        const id = uuidv4();
        const fullEntry: MemoryEntry = {
            ...entry,
            id,
            timestamp: new Date(),
        };

        this.entries.set(id, fullEntry);
        return id;
    }

    async get(id: string): Promise<MemoryEntry | null> {
        return this.entries.get(id) ?? null;
    }

    async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
        const existing = this.entries.get(id);
        if (!existing) {
            throw new Error(`Entry ${id} not found`);
        }

        this.entries.set(id, { ...existing, ...updates, id }); // Preserve ID
    }

    async delete(id: string): Promise<void> {
        this.entries.delete(id);
    }

    async query(query: MemoryQuery): Promise<MemoryEntry[]> {
        let results = Array.from(this.entries.values());

        // Filter by types
        if (query.types && query.types.length > 0) {
            results = results.filter((e) => query.types!.includes(e.type));
        }

        // Filter by agentId
        if (query.agentId) {
            results = results.filter((e) => e.metadata.agentId === query.agentId);
        }

        // Filter by taskId
        if (query.taskId) {
            results = results.filter((e) => e.metadata.taskId === query.taskId);
        }

        // Filter by projectPath
        if (query.projectPath) {
            results = results.filter((e) => e.metadata.projectPath === query.projectPath);
        }

        // Filter by tags (any match)
        if (query.tags && query.tags.length > 0) {
            results = results.filter(
                (e) => e.metadata.tags?.some((t) => query.tags!.includes(t))
            );
        }

        // Filter by date range
        if (query.fromDate) {
            results = results.filter((e) => e.timestamp >= query.fromDate!);
        }
        if (query.toDate) {
            results = results.filter((e) => e.timestamp <= query.toDate!);
        }

        // Sort
        const orderBy = query.orderBy || 'timestamp';
        const orderDir = query.orderDir || 'desc';

        results.sort((a, b) => {
            let cmp: number;
            if (orderBy === 'timestamp') {
                cmp = a.timestamp.getTime() - b.timestamp.getTime();
            } else {
                // importance
                const importanceOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                const aImp = importanceOrder[a.metadata.importance || 'medium'];
                const bImp = importanceOrder[b.metadata.importance || 'medium'];
                cmp = aImp - bImp;
            }
            return orderDir === 'asc' ? cmp : -cmp;
        });

        // Apply pagination
        if (query.offset) {
            results = results.slice(query.offset);
        }
        if (query.limit) {
            results = results.slice(0, query.limit);
        }

        return results;
    }

    async search(text: string, options?: SearchOptions): Promise<MemoryEntry[]> {
        const searchLower = text.toLowerCase();
        let results = Array.from(this.entries.values());

        // Simple text search (case-insensitive)
        results = results.filter((e) =>
            e.content.toLowerCase().includes(searchLower)
        );

        // Filter by types
        if (options?.types && options.types.length > 0) {
            results = results.filter((e) => options.types!.includes(e.type));
        }

        // Limit results
        if (options?.limit) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    async clear(types?: MemoryType[]): Promise<void> {
        if (!types || types.length === 0) {
            this.entries.clear();
        } else {
            for (const [id, entry] of this.entries) {
                if (types.includes(entry.type)) {
                    this.entries.delete(id);
                }
            }
        }
    }

    async count(query?: MemoryQuery): Promise<number> {
        if (!query) {
            return this.entries.size;
        }

        const results = await this.query({ ...query, limit: undefined, offset: undefined });
        return results.length;
    }

    /**
     * Get all entries (for debugging)
     */
    getAll(): MemoryEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Export to JSON
     */
    export(): string {
        return JSON.stringify(this.getAll(), null, 2);
    }

    /**
     * Import from JSON
     */
    import(json: string): void {
        const entries: MemoryEntry[] = JSON.parse(json);
        for (const entry of entries) {
            entry.timestamp = new Date(entry.timestamp);
            this.entries.set(entry.id, entry);
        }
    }
}
