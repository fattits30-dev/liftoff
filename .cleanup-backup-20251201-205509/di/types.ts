/**
 * Dependency Injection Tokens
 * Symbols used for type-safe dependency injection
 */

export const TYPES = {
    // Core Interfaces
    MemoryStore: Symbol.for('MemoryStore'),
    LLMProvider: Symbol.for('LLMProvider'),
    ToolExecutor: Symbol.for('ToolExecutor'),
    EventBus: Symbol.for('EventBus'),
    AgentRunner: Symbol.for('AgentRunner'),

    // Services
    OrchestratorService: Symbol.for('OrchestratorService'),
    AgentService: Symbol.for('AgentService'),
    PlanningService: Symbol.for('PlanningService'),
    DelegationService: Symbol.for('DelegationService'),
    MemoryService: Symbol.for('MemoryService'),

    // Infrastructure
    McpRouter: Symbol.for('McpRouter'),
    McpServerManager: Symbol.for('McpServerManager'),
    LocalMcpServer: Symbol.for('LocalMcpServer'),
    ToolRegistry: Symbol.for('ToolRegistry'),

    // Collaboration
    AgentCoordinator: Symbol.for('AgentCoordinator'),
    MessageBus: Symbol.for('MessageBus'),
    RetryAnalyzer: Symbol.for('RetryAnalyzer'),
    SubAgentManager: Symbol.for('SubAgentManager'),

    // UI
    ExtensionContext: Symbol.for('ExtensionContext'),
    OutputChannel: Symbol.for('OutputChannel'),
    WebviewProvider: Symbol.for('WebviewProvider'),

    // Config
    Config: Symbol.for('Config'),
    ExtensionPath: Symbol.for('ExtensionPath'),
} as const;

export type TypeKeys = keyof typeof TYPES;
