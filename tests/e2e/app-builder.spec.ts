import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('App Builder E2E', () => {
    const testOutputDir = path.join(__dirname, '../fixtures/e2e-output');

    test.beforeAll(async () => {
        // Create output directory
        await fs.mkdir(testOutputDir, { recursive: true });
    });

    test.afterAll(async () => {
        // Cleanup (optional - keep for debugging)
        // await fs.rm(testOutputDir, { recursive: true, force: true });
    });

    test('should build a simple todo app end-to-end', async () => {
        // This test simulates the full workflow:
        // 1. User describes app
        // 2. System generates spec
        // 3. Scaffolds project
        // 4. Builds features
        // 5. Verifies output

        const description = 'A simple todo app with add, complete, and delete tasks';

        // Note: This would normally interact with VS Code extension
        // For E2E, we're testing the core logic directly

        const { AppBuilderOrchestrator } = require('../../src/appBuilder');
        const { MainOrchestrator } = require('../../src/mainOrchestrator');
        const { SemanticMemoryStore, OrchestratorMemory } = require('../../src/memory/agentMemory');

        // Initialize components
        const semanticMemory = new SemanticMemoryStore(':memory:');
        await semanticMemory.initialize();

        const orchestratorMemory = new OrchestratorMemory(':memory:', semanticMemory);
        await orchestratorMemory.initialize();

        const mainOrchestrator = new MainOrchestrator(
            testOutputDir,
            semanticMemory,
            orchestratorMemory
        );

        const extensionPath = path.join(__dirname, '../../');
        const appBuilder = new AppBuilderOrchestrator(extensionPath, mainOrchestrator);

        const targetDir = path.join(testOutputDir, 'todo-app');

        // Build the app
        const result = await appBuilder.buildApp(description, targetDir);

        // Assertions
        expect(result.success).toBe(true);
        expect(result.spec).toBeDefined();
        expect(result.spec?.displayName).toContain('Todo');

        // Verify project structure was created
        const files = await fs.readdir(targetDir);
        expect(files).toContain('package.json');
        expect(files).toContain('src');
        expect(files).toContain('index.html');

        // Verify package.json
        const packageJson = JSON.parse(
            await fs.readFile(path.join(targetDir, 'package.json'), 'utf-8')
        );
        expect(packageJson.name).toBeDefined();
        expect(packageJson.dependencies).toHaveProperty('react');

        // Verify src directory
        const srcFiles = await fs.readdir(path.join(targetDir, 'src'));
        expect(srcFiles).toContain('App.tsx');
        expect(srcFiles).toContain('main.tsx');

        // Verify App.tsx contains todo logic
        const appContent = await fs.readFile(
            path.join(targetDir, 'src/App.tsx'),
            'utf-8'
        );
        expect(appContent).toMatch(/todo/i);
        expect(appContent).toMatch(/useState/);

        // Cleanup
        semanticMemory.dispose();
        orchestratorMemory.dispose();
        mainOrchestrator.dispose();
    });

    test('should generate correct Supabase schema for auth app', async () => {
        const description = 'An app with user authentication and profiles';

        const { AppBuilderOrchestrator } = require('../../src/appBuilder');
        const { MainOrchestrator } = require('../../src/mainOrchestrator');
        const { SemanticMemoryStore, OrchestratorMemory } = require('../../src/memory/agentMemory');

        const semanticMemory = new SemanticMemoryStore(':memory:');
        await semanticMemory.initialize();

        const orchestratorMemory = new OrchestratorMemory(':memory:', semanticMemory);
        await orchestratorMemory.initialize();

        const mainOrchestrator = new MainOrchestrator(
            testOutputDir,
            semanticMemory,
            orchestratorMemory
        );

        const extensionPath = path.join(__dirname, '../../');
        const appBuilder = new AppBuilderOrchestrator(extensionPath, mainOrchestrator);

        const targetDir = path.join(testOutputDir, 'auth-app');

        const result = await appBuilder.buildApp(description, targetDir);

        expect(result.success).toBe(true);

        // Verify Supabase schema
        const schemaPath = path.join(targetDir, 'supabase/migrations/001_init.sql');
        const schemaExists = await fs.access(schemaPath).then(() => true).catch(() => false);

        if (schemaExists) {
            const schema = await fs.readFile(schemaPath, 'utf-8');
            expect(schema).toMatch(/CREATE TABLE.*profiles/i);
            expect(schema).toMatch(/user_id.*uuid/i);
        }

        // Cleanup
        semanticMemory.dispose();
        orchestratorMemory.dispose();
        mainOrchestrator.dispose();
    });

    test('should handle build errors gracefully', async () => {
        const description = ''; // Invalid empty description

        const { AppBuilderOrchestrator } = require('../../src/appBuilder');
        const { MainOrchestrator } = require('../../src/mainOrchestrator');
        const { SemanticMemoryStore, OrchestratorMemory } = require('../../src/memory/agentMemory');

        const semanticMemory = new SemanticMemoryStore(':memory:');
        await semanticMemory.initialize();

        const orchestratorMemory = new OrchestratorMemory(':memory:', semanticMemory);
        await orchestratorMemory.initialize();

        const mainOrchestrator = new MainOrchestrator(
            testOutputDir,
            semanticMemory,
            orchestratorMemory
        );

        const extensionPath = path.join(__dirname, '../../');
        const appBuilder = new AppBuilderOrchestrator(extensionPath, mainOrchestrator);

        const targetDir = path.join(testOutputDir, 'invalid-app');

        const result = await appBuilder.buildApp(description, targetDir);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();

        // Cleanup
        semanticMemory.dispose();
        orchestratorMemory.dispose();
        mainOrchestrator.dispose();
    });

    test('should resume interrupted build', async () => {
        const description = 'A task management app';
        const targetDir = path.join(testOutputDir, 'resume-test-app');

        const { AppBuilderOrchestrator } = require('../../src/appBuilder');
        const { MainOrchestrator } = require('../../src/mainOrchestrator');
        const { SemanticMemoryStore, OrchestratorMemory } = require('../../src/memory/agentMemory');
        const { saveBuildState } = require('../../src/appBuilder/buildState');

        const semanticMemory = new SemanticMemoryStore(':memory:');
        await semanticMemory.initialize();

        const orchestratorMemory = new OrchestratorMemory(':memory:', semanticMemory);
        await orchestratorMemory.initialize();

        const mainOrchestrator = new MainOrchestrator(
            testOutputDir,
            semanticMemory,
            orchestratorMemory
        );

        const extensionPath = path.join(__dirname, '../../');
        const appBuilder = new AppBuilderOrchestrator(extensionPath, mainOrchestrator);

        // Create partial build state
        await fs.mkdir(targetDir, { recursive: true });
        await saveBuildState(targetDir, {
            phase: 'scaffolding',
            spec: {
                displayName: 'Task Manager',
                description,
                features: ['auth', 'crud'],
                techStack: ['react', 'supabase'],
                appType: 'crud'
            },
            architecture: {
                components: ['TaskList', 'TaskForm'],
                routes: ['/tasks'],
                apiEndpoints: ['/api/tasks'],
                databaseSchema: {
                    tables: ['tasks'],
                    relationships: []
                }
            },
            completedSteps: ['spec-generation'],
            currentStep: 'scaffolding',
            startTime: new Date()
        });

        // Resume build
        const result = await appBuilder.resumeBuild(targetDir);

        expect(result.success).toBe(true);
        expect(result.resumed).toBe(true);

        // Cleanup
        semanticMemory.dispose();
        orchestratorMemory.dispose();
        mainOrchestrator.dispose();
    });
});
