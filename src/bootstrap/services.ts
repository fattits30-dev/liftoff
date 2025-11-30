/**
 * Service Bootstrap
 * Initializes and wires up all core services using DI container
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Container } from '../di/Container';
import { TYPES } from '../di/types';
import { IEventBus } from '../core/interfaces/IEventBus';
import { IMemoryStore } from '../core/interfaces/IMemoryStore';
import { EventBus } from '../infrastructure/events/EventBus';
import { createCompositeMemory } from '../infrastructure/memory/CompositeMemory';
import { ToolRegistry } from '../infrastructure/execution/ToolRegistry';
import { createLegacyToolsModule } from '../infrastructure/execution/LegacyToolsModule';
import { createSandboxToolsModule } from '../infrastructure/execution/SandboxToolsModule';

// Legacy imports for compatibility
import { SemanticMemoryStore, OrchestratorMemory } from '../memory/agentMemory';
import { AutonomousAgentManager } from '../autonomousAgent';
import { MainOrchestrator } from '../mainOrchestrator';
import { AppBuilderOrchestrator } from '../appBuilder';
import { PersistenceManager } from '../persistence';


/**
 * Service container with typed getters
 */
export interface ServiceContainer {
    // Core infrastructure
    eventBus: IEventBus;
    memoryStore: IMemoryStore;
    toolRegistry: ToolRegistry;

    // Legacy services
    semanticMemory: SemanticMemoryStore;
    orchestratorMemory: OrchestratorMemory;
    agentManager: AutonomousAgentManager;
    orchestrator: MainOrchestrator;
    appBuilder: AppBuilderOrchestrator;
    persistenceManager: PersistenceManager;
    

    // Logging
    outputChannel: vscode.OutputChannel;
    log: (message: string) => void;
}

/**
 * Bootstrap all services
 */
export async function bootstrapServices(
    context: vscode.ExtensionContext
): Promise<ServiceContainer> {
    // Create output channel
    const outputChannel = vscode.window.createOutputChannel('Liftoff Extension');
    context.subscriptions.push(outputChannel);

    const log = (msg: string) => {
        outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
    };

    log('🚀 Liftoff bootstrapping services...');

    // Initialize DI container
    const container = new Container();

    // Create event bus
    const eventBus = new EventBus();
    container.registerInstance(TYPES.EventBus, eventBus);

    // Create memory infrastructure
    const storagePath = context.globalStorageUri.fsPath;
    const memoryPath = path.join(storagePath, 'memory');
    const memoryStore = createCompositeMemory(memoryPath, eventBus);
    container.registerInstance(TYPES.MemoryStore, memoryStore);

    // Legacy memory (for backwards compatibility)
    const semanticMemory = new SemanticMemoryStore(path.join(memoryPath, 'semantic.json'));
    const orchestratorMemory = new OrchestratorMemory(
        path.join(memoryPath, 'orchestrator.json'),
        semanticMemory
    );

    await Promise.all([
        semanticMemory.initialize(),
        orchestratorMemory.initialize(),
    ]);

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // Create tool registry with modules
    const toolRegistry = new ToolRegistry(eventBus);
    toolRegistry.registerModule(createLegacyToolsModule(workspaceRoot));

    toolRegistry.registerModule(createSandboxToolsModule({
        workspaceRoot,
        timeout: 60000,
    }));

    container.registerInstance(TYPES.ToolExecutor, toolRegistry);

    // Create agent manager
    const agentManager = new AutonomousAgentManager(context, semanticMemory);

    // Create orchestrator
    const orchestrator = new MainOrchestrator(workspaceRoot, semanticMemory, orchestratorMemory);
    orchestrator.setAgentManager(agentManager);
    container.registerInstance(TYPES.AgentRunner, orchestrator);

    // Create app builder
    const appBuilder = new AppBuilderOrchestrator(context.extensionPath, orchestrator);

    // Create persistence manager
    const persistenceManager = new PersistenceManager(context);

    log('✅ Services bootstrapped');

    return {
        eventBus,
        memoryStore,
        toolRegistry,
        semanticMemory,
        orchestratorMemory,
        agentManager,
        orchestrator,
        appBuilder,
        persistenceManager,
        outputChannel,
        log,
    };
}

/**
 * Dispose all services
 */
export function disposeServices(services: ServiceContainer): void {
    services.agentManager.dispose?.();
    services.orchestrator.dispose?.();
    services.appBuilder.dispose?.();
    services.outputChannel.dispose();
}
