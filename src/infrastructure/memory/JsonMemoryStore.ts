/**
 * JSON File Memory Store
 * Persists memory to JSON files for simple persistence
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
    IMemoryStore,
    MemoryEntry,
    MemoryQuery,
    MemoryType,
    SearchOptions,
} from '../../core/interfaces/IMemoryStore';

export class JsonMemoryStore implements IMemoryStore {
    private entries = new Map<string, MemoryEntry>();
    private storePath: string;
    private dirty = false;
    private saveTimer?: NodeJS.Timeout;

    constructor(storePath: string) {
        this.storePath = storePath;
    }

    /**
     * Initialize the store (load from file)
     */
    async initialize(): Promise<void> {
        try {
            const content = await fs.readFile(this.storePath, 'utf-8');
            const data: MemoryEntry[] = JSON.parse(content);

            for (const entry of data) {
                entry.timestamp = new Date(entry.timestamp);
                this.entries.set(entry.id, entry);
            }
        } catch {
            // File doesn't exist or is invalid, start fresh
            this.entries.clear();
        }
    }

    async add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
        const id = uuidv4();
        const fullEntry: MemoryEntry = {
            ...entry,
            id,
            timestamp: new Date(),
        };

        this.entries.set(id, fullEntry);
        this.scheduleSave();

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

        this.entries.set(id, { ...existing, ...updates, id });
        this.scheduleSave();
    }

    async delete(id: string): Promise<void> {
        if (this.entries.delete(id)) {
            this.scheduleSave();
        }
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

        // Filter by tags
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

        // Simple text search
        results = results.filter((e) =>
            e.content.toLowerCase().includes(searchLower)
        );

        // Filter by types
        if (options?.types && options.types.length > 0) {
            results = results.filter((e) => options.types!.includes(e.type));
        }

        // Limit
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
        this.scheduleSave();
    }

    async count(query?: MemoryQuery): Promise<number> {
        if (!query) {
            return this.entries.size;
        }

        const results = await this.query({ ...query, limit: undefined, offset: undefined });
        return results.length;
    }

    /**
     * Schedule a save operation (debounced)
     */
    private scheduleSave(): void {
        this.dirty = true;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(() => {
            this.save().catch(console.error);
        }, 1000);
    }

    /**
     * Save to file immediately
     */
    async save(): Promise<void> {
        if (!this.dirty) return;

        const data = Array.from(this.entries.values());
        const dir = path.dirname(this.storePath);

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8');

        this.dirty = false;
    }

    /**
     * Cleanup
     */
    async dispose(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        await this.save();
    }
}
