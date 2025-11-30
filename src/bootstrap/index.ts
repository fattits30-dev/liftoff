/**
 * Bootstrap Module
 * Clean entry point for initializing the Liftoff extension
 */

import * as vscode from 'vscode';
import { ServiceContainer, bootstrapServices, disposeServices } from './services';
import { registerCommands } from './commands';
import { ManagerViewProvider } from '../managerViewProvider';
import { ArtifactViewerProvider } from '../artifactViewerProvider';

export { ServiceContainer, bootstrapServices, disposeServices };

/**
 * Bootstrap the entire extension
 */
export async function bootstrap(
    context: vscode.ExtensionContext
): Promise<ServiceContainer> {
    // Initialize services
    const services = await bootstrapServices(context);

    // Create status bar
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(rocket) Liftoff';
    statusBarItem.tooltip = 'Autonomous AI Agents';
    statusBarItem.command = 'liftoff.openManager';
    statusBarItem.show();

    // Update status bar on agent changes
    services.agentManager.onAgentUpdate(() => {
        const running = services.agentManager.getRunningAgents().length;
        statusBarItem.text = running > 0
            ? `$(rocket) Liftoff ☁️ (${running} active)`
            : '$(rocket) Liftoff ☁️';
    });

    // Register webview providers
    const managerProvider = new ManagerViewProvider(
        context.extensionUri,
        services.agentManager
    );
    const artifactProvider = new ArtifactViewerProvider(
        context.extensionUri,
        services.agentManager
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('liftoff.managerView', managerProvider),
        vscode.window.registerWebviewViewProvider('liftoff.artifactView', artifactProvider)
    );

    // Register commands
    const commandDisposables = registerCommands(context, services);
    context.subscriptions.push(...commandDisposables);

    // Apply API key from config
    const config = vscode.workspace.getConfiguration('liftoff');
    const apiKey = config.get<string>('huggingfaceApiKey');
    
    if (apiKey) {
        await services.agentManager.setApiKey(apiKey);
        await services.orchestrator.setApiKey(apiKey);
        services.log('API key loaded from configuration');
    } else {
        vscode.window.showInformationMessage(
            '🚀 Liftoff ready! Set your HuggingFace API key to start.',
            'Set Key'
        ).then(action => {
            if (action) {
                vscode.commands.executeCommand('liftoff.setApiKey');
            }
        });
    }

    // Add disposables
    context.subscriptions.push(
        statusBarItem,
        services.agentManager,
        services.orchestrator,
        services.appBuilder
    );

    services.log('✅ Liftoff extension activated');

    return services;
}

/**
 * Cleanup on extension deactivation
 */
export function cleanup(services: ServiceContainer): void {
    services.log('Liftoff deactivating...');
    disposeServices(services);
}
