/**
 * Unified Memory Store Interface
 * Consolidates 5 fragmented memory systems into one interface
 */

export type MemoryType =
    | 'action'      // From SemanticMemoryStore
    | 'error'       // From SemanticMemoryStore
    | 'success'     // From SemanticMemoryStore
    | 'plan'        // From OrchestratorMemory
    | 'decision'    // From OrchestratorMemory
    | 'context'     // From AgentMemory
    | 'lesson'      // From LessonsManager
    | 'session'     // From PersistenceManager
    | 'conversation';

export interface MemoryEntry {
    id: string;
    type: MemoryType;
    content: string;
    metadata: MemoryMetadata;
    embedding?: number[];
    timestamp: Date;
    ttl?: number;  // Time to live in seconds
}

export interface MemoryMetadata {
    agentId?: string;
    taskId?: string;
    projectPath?: string;
    tags?: string[];
    importance?: 'low' | 'medium' | 'high' | 'critical';
    source?: string;
    [key: string]: unknown;
}

export interface MemoryQuery {
    types?: MemoryType[];
    agentId?: string;
    taskId?: string;
    projectPath?: string;
    tags?: string[];
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
    orderBy?: 'timestamp' | 'importance';
    orderDir?: 'asc' | 'desc';
}

export interface SearchOptions {
    threshold?: number;  // Similarity threshold for semantic search
    limit?: number;
    types?: MemoryType[];
}

export interface IMemoryStore {
    /**
     * Add a new memory entry
     */
    add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string>;

    /**
     * Get a specific memory entry by ID
     */
    get(id: string): Promise<MemoryEntry | null>;

    /**
     * Update an existing memory entry
     */
    update(id: string, updates: Partial<MemoryEntry>): Promise<void>;

    /**
     * Delete a memory entry
     */
    delete(id: string): Promise<void>;

    /**
     * Query memories with filters
     */
    query(query: MemoryQuery): Promise<MemoryEntry[]>;

    /**
     * Semantic search for relevant memories
     */
    search(text: string, options?: SearchOptions): Promise<MemoryEntry[]>;

    /**
     * Clear all memories (optionally by type)
     */
    clear(types?: MemoryType[]): Promise<void>;

    /**
     * Get count of memories
     */
    count(query?: MemoryQuery): Promise<number>;
}
