/**
 * MCP Server Manager
 * Manages MCP server lifecycle, health monitoring, and auto-reconnection
 */

import { EventEmitter } from 'events';
import { McpClient } from './client';
import { IEventBus, EventType } from '../core/interfaces/IEventBus';

export interface ServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;  // Connection timeout in ms
    healthCheckInterval?: number;  // Health check interval in ms
    maxReconnectAttempts?: number;
    reconnectDelay?: number;  // Initial reconnect delay in ms
}

export type ServerStatus =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'unhealthy'
    | 'reconnecting'
    | 'failed';

export interface ServerHealth {
    status: ServerStatus;
    lastHealthCheck?: Date;
    lastPing?: number;  // Ping time in ms
    errorCount: number;
    lastError?: string;
    uptime?: number;  // Uptime in ms
    toolCount?: number;
}

interface ServerState {
    config: ServerConfig;
    client: McpClient | null;
    status: ServerStatus;
    health: ServerHealth;
    reconnectAttempts: number;
    connectedAt?: Date;
    healthCheckTimer?: NodeJS.Timeout;
}

export class McpServerManager extends EventEmitter {
    private servers = new Map<string, ServerState>();
    private eventBus?: IEventBus;
    private isShuttingDown = false;

    private readonly defaultConfig = {
        timeout: 30000,
        healthCheckInterval: 30000,
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
    };

    constructor(eventBus?: IEventBus) {
        super();
        this.eventBus = eventBus;
    }

    /**
     * Start a new MCP server
     */
    async startServer(config: ServerConfig): Promise<void> {
        const fullConfig = { ...this.defaultConfig, ...config };

        if (this.servers.has(config.name)) {
            throw new Error(`Server ${config.name} is already registered`);
        }

        const state: ServerState = {
            config: fullConfig,
            client: null,
            status: 'disconnected',
            health: {
                status: 'disconnected',
                errorCount: 0,
            },
            reconnectAttempts: 0,
        };

        this.servers.set(config.name, state);
        await this.connect(config.name);
    }

    /**
     * Connect to a server
     */
    private async connect(name: string): Promise<void> {
        const state = this.servers.get(name);
        if (!state) throw new Error(`Server ${name} not found`);

        this.updateStatus(name, 'connecting');

        try {
            const client = new McpClient({
                name: state.config.name,
                command: state.config.command,
                args: state.config.args,
                env: state.config.env,
                cwd: state.config.cwd,
            });
            await client.connect();

            state.client = client;
            state.connectedAt = new Date();
            state.reconnectAttempts = 0;
            state.health.errorCount = 0;
            state.health.lastError = undefined;

            this.updateStatus(name, 'connected');
            this.startHealthMonitoring(name);

            this.emitEvent('mcp:server:connected', { name, config: state.config });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            state.health.lastError = errorMessage;
            state.health.errorCount++;

            this.updateStatus(name, 'failed');
            this.emitEvent('mcp:server:error', { name, error: errorMessage });

            // Attempt reconnect
            await this.scheduleReconnect(name);
        }
    }

    /**
     * Stop a server
     */
    async stopServer(name: string): Promise<void> {
        const state = this.servers.get(name);
        if (!state) return;

        this.stopHealthMonitoring(name);

        if (state.client) {
            try {
                await state.client.disconnect();
            } catch {
                // Ignore disconnect errors
            }
            state.client = null;
        }

        this.updateStatus(name, 'disconnected');
        this.servers.delete(name);

        this.emitEvent('mcp:server:disconnected', { name });
    }

    /**
     * Check health of a server
     */
    async checkHealth(name: string): Promise<ServerHealth> {
        const state = this.servers.get(name);
        if (!state) {
            return {
                status: 'disconnected',
                errorCount: 0,
            };
        }

        if (!state.client || state.status !== 'connected') {
            return state.health;
        }

        try {
            const startTime = Date.now();

            // Ping by listing tools (lightweight operation)
            const tools = await state.client.listTools();

            const pingTime = Date.now() - startTime;

            state.health.lastHealthCheck = new Date();
            state.health.lastPing = pingTime;
            state.health.toolCount = tools.length;
            state.health.status = 'connected';
            state.health.uptime = state.connectedAt
                ? Date.now() - state.connectedAt.getTime()
                : 0;

            this.emitEvent('mcp:server:health', {
                name,
                health: state.health
            });

            return state.health;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            state.health.lastError = errorMessage;
            state.health.errorCount++;
            state.health.status = 'unhealthy';

            this.emitEvent('mcp:server:error', { name, error: errorMessage });

            // If too many errors, try to reconnect
            if (state.health.errorCount >= 3) {
                await this.reconnect(name);
            }

            return state.health;
        }
    }

    /**
     * Start health monitoring for a server
     */
    private startHealthMonitoring(name: string): void {
        const state = this.servers.get(name);
        if (!state) return;

        this.stopHealthMonitoring(name);

        state.healthCheckTimer = setInterval(async () => {
            if (!this.isShuttingDown && state.status === 'connected') {
                await this.checkHealth(name);
            }
        }, state.config.healthCheckInterval ?? this.defaultConfig.healthCheckInterval);
    }

    /**
     * Stop health monitoring for a server
     */
    private stopHealthMonitoring(name: string): void {
        const state = this.servers.get(name);
        if (state?.healthCheckTimer) {
            clearInterval(state.healthCheckTimer);
            state.healthCheckTimer = undefined;
        }
    }

    /**
     * Reconnect to a server
     */
    private async reconnect(name: string): Promise<void> {
        const state = this.servers.get(name);
        if (!state || this.isShuttingDown) return;

        this.stopHealthMonitoring(name);

        if (state.client) {
            try {
                await state.client.disconnect();
            } catch {
                // Ignore disconnect errors
            }
            state.client = null;
        }

        await this.connect(name);
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private async scheduleReconnect(name: string): Promise<void> {
        const state = this.servers.get(name);
        if (!state || this.isShuttingDown) return;

        const maxAttempts = state.config.maxReconnectAttempts ?? this.defaultConfig.maxReconnectAttempts;

        if (state.reconnectAttempts >= maxAttempts) {
            this.updateStatus(name, 'failed');
            return;
        }

        state.reconnectAttempts++;
        this.updateStatus(name, 'reconnecting');

        // Exponential backoff
        const baseDelay = state.config.reconnectDelay ?? this.defaultConfig.reconnectDelay;
        const delay = baseDelay * Math.pow(2, state.reconnectAttempts - 1);

        await new Promise(resolve => setTimeout(resolve, delay));

        if (!this.isShuttingDown && this.servers.has(name)) {
            await this.connect(name);
        }
    }

    /**
     * Update server status
     */
    private updateStatus(name: string, status: ServerStatus): void {
        const state = this.servers.get(name);
        if (state) {
            state.status = status;
            state.health.status = status;
            this.emit('statusChange', { name, status });
        }
    }

    /**
     * Emit event to event bus
     */
    private emitEvent(type: EventType, payload: unknown): void {
        if (this.eventBus) {
            this.eventBus.emit(type, payload, { source: 'McpServerManager' });
        }
    }

    /**
     * Get a server's client
     */
    getClient(name: string): McpClient | null {
        return this.servers.get(name)?.client ?? null;
    }

    /**
     * Get server status
     */
    getStatus(name: string): ServerStatus {
        return this.servers.get(name)?.status ?? 'disconnected';
    }

    /**
     * Get all server statuses
     */
    getAllStatuses(): Map<string, ServerHealth> {
        const result = new Map<string, ServerHealth>();
        for (const [name, state] of this.servers) {
            result.set(name, state.health);
        }
        return result;
    }

    /**
     * Check if a server is connected and healthy
     */
    isHealthy(name: string): boolean {
        const state = this.servers.get(name);
        return state?.status === 'connected' && state.health.status === 'connected';
    }

    /**
     * Get list of connected servers
     */
    getConnectedServers(): string[] {
        return Array.from(this.servers.entries())
            .filter(([, state]) => state.status === 'connected')
            .map(([name]) => name);
    }

    /**
     * Shutdown all servers
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        const shutdownPromises = Array.from(this.servers.keys()).map(name =>
            this.stopServer(name)
        );

        await Promise.all(shutdownPromises);
        this.servers.clear();
    }
}
