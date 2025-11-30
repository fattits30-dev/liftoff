/**
 * Memory Entity
 * Domain model for memory entries
 */

import { MemoryType, MemoryMetadata, MemoryEntry } from '../interfaces/IMemoryStore';
import { v4 as uuidv4 } from 'uuid';

export class Memory implements MemoryEntry {
    readonly id: string;
    readonly type: MemoryType;
    readonly content: string;
    readonly metadata: MemoryMetadata;
    readonly timestamp: Date;
    readonly ttl?: number;
    embedding?: number[];

    constructor(options: {
        id?: string;
        type: MemoryType;
        content: string;
        metadata?: MemoryMetadata;
        timestamp?: Date;
        ttl?: number;
        embedding?: number[];
    }) {
        this.id = options.id ?? uuidv4();
        this.type = options.type;
        this.content = options.content;
        this.metadata = options.metadata ?? {};
        this.timestamp = options.timestamp ?? new Date();
        this.ttl = options.ttl;
        this.embedding = options.embedding;
    }

    /**
     * Check if memory has expired
     */
    isExpired(): boolean {
        if (!this.ttl) return false;
        const expiresAt = new Date(this.timestamp.getTime() + this.ttl * 1000);
        return new Date() > expiresAt;
    }

    /**
     * Get expiration date
     */
    getExpirationDate(): Date | null {
        if (!this.ttl) return null;
        return new Date(this.timestamp.getTime() + this.ttl * 1000);
    }

    /**
     * Get age in seconds
     */
    getAge(): number {
        return Math.floor((Date.now() - this.timestamp.getTime()) / 1000);
    }

    /**
     * Check if memory has embedding
     */
    hasEmbedding(): boolean {
        return !!this.embedding && this.embedding.length > 0;
    }

    /**
     * Create a copy with updated fields
     */
    with(updates: Partial<Omit<MemoryEntry, 'id' | 'timestamp'>>): Memory {
        return new Memory({
            id: this.id,
            type: updates.type ?? this.type,
            content: updates.content ?? this.content,
            metadata: updates.metadata ?? this.metadata,
            timestamp: this.timestamp,
            ttl: updates.ttl ?? this.ttl,
            embedding: updates.embedding ?? this.embedding,
        });
    }

    /**
     * Convert to plain object
     */
    toJSON(): MemoryEntry {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            metadata: this.metadata,
            timestamp: this.timestamp,
            ttl: this.ttl,
            embedding: this.embedding,
        };
    }

    /**
     * Create from plain object
     */
    static from(entry: MemoryEntry): Memory {
        return new Memory({
            id: entry.id,
            type: entry.type,
            content: entry.content,
            metadata: entry.metadata,
            timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
            ttl: entry.ttl,
            embedding: entry.embedding,
        });
    }

    /**
     * Create an action memory
     */
    static action(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'action',
            content,
            metadata: { ...metadata, importance: 'medium' },
        });
    }

    /**
     * Create an error memory
     */
    static error(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'error',
            content,
            metadata: { ...metadata, importance: 'high' },
        });
    }

    /**
     * Create a success memory
     */
    static success(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'success',
            content,
            metadata: { ...metadata, importance: 'medium' },
        });
    }

    /**
     * Create a plan memory
     */
    static plan(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'plan',
            content,
            metadata: { ...metadata, importance: 'high' },
        });
    }

    /**
     * Create a decision memory
     */
    static decision(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'decision',
            content,
            metadata: { ...metadata, importance: 'high' },
        });
    }

    /**
     * Create a context memory
     */
    static context(content: string, agentId: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'context',
            content,
            metadata: { ...metadata, agentId },
        });
    }

    /**
     * Create a lesson memory
     */
    static lesson(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'lesson',
            content,
            metadata: { ...metadata, importance: 'critical' },
        });
    }

    /**
     * Create a session memory
     */
    static session(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'session',
            content,
            metadata,
        });
    }

    /**
     * Create a conversation memory
     */
    static conversation(content: string, metadata?: MemoryMetadata): Memory {
        return new Memory({
            type: 'conversation',
            content,
            metadata,
            ttl: 3600, // 1 hour default TTL
        });
    }
}
