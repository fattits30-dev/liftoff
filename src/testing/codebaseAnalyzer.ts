/**
 * Codebase Analyzer - Understand existing projects for test generation
 *
 * Scans a codebase to identify:
 * - React components and their props
 * - API endpoints and routes
 * - Utility functions
 * - Database models/operations
 * - Authentication flows
 * - User workflows
 *
 * Used for generating tests for EXISTING apps (not just new builds)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ComponentInfo {
    name: string;
    filePath: string;
    props: string[];
    hooks: string[];
    exports: string[];
    type: 'page' | 'component' | 'layout';
}

export interface APIEndpoint {
    path: string;
    method: string;
    filePath: string;
    handler: string;
    params: string[];
}

export interface UtilityFunction {
    name: string;
    filePath: string;
    params: string[];
    returnType?: string;
}

export interface DatabaseModel {
    name: string;
    filePath: string;
    fields: string[];
    operations: string[];
}

export interface CodebaseStructure {
    framework: 'react' | 'vue' | 'angular' | 'vanilla' | 'unknown';
    backend: 'express' | 'fastify' | 'nest' | 'none' | 'unknown';
    database: 'supabase' | 'postgresql' | 'mongodb' | 'sqlite' | 'none';
    testing: {
        hasTests: boolean;
        framework?: 'vitest' | 'jest' | 'mocha' | 'playwright';
        coverage?: number;
    };
    components: ComponentInfo[];
    apiEndpoints: APIEndpoint[];
    utilities: UtilityFunction[];
    models: DatabaseModel[];
}

export class CodebaseAnalyzer {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Analyze entire codebase
     */
    async analyze(): Promise<CodebaseStructure> {
        const packageJson = await this.readPackageJson();

        const structure: CodebaseStructure = {
            framework: this.detectFramework(packageJson),
            backend: this.detectBackend(packageJson),
            database: this.detectDatabase(packageJson),
            testing: await this.analyzeTesting(packageJson),
            components: await this.findComponents(),
            apiEndpoints: await this.findAPIEndpoints(),
            utilities: await this.findUtilities(),
            models: await this.findModels()
        };

        return structure;
    }

    /**
     * Read and parse package.json
     */
    private async readPackageJson(): Promise<any> {
        const pkgPath = path.join(this.workspaceRoot, 'package.json');
        try {
            const content = fs.readFileSync(pkgPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            return { dependencies: {}, devDependencies: {} };
        }
    }

    /**
     * Detect frontend framework
     */
    private detectFramework(packageJson: any): CodebaseStructure['framework'] {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps.react) return 'react';
        if (deps.vue) return 'vue';
        if (deps['@angular/core']) return 'angular';
        return 'unknown';
    }

    /**
     * Detect backend framework
     */
    private detectBackend(packageJson: any): CodebaseStructure['backend'] {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps.express) return 'express';
        if (deps.fastify) return 'fastify';
        if (deps['@nestjs/core']) return 'nest';
        return 'none';
    }

    /**
     * Detect database
     */
    private detectDatabase(packageJson: any): CodebaseStructure['database'] {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps['@supabase/supabase-js']) return 'supabase';
        if (deps.pg || deps.postgresql) return 'postgresql';
        if (deps.mongodb || deps.mongoose) return 'mongodb';
        if (deps['better-sqlite3'] || deps.sqlite3) return 'sqlite';
        return 'none';
    }

    /**
     * Analyze testing setup and coverage
     */
    private async analyzeTesting(packageJson: any): Promise<CodebaseStructure['testing']> {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        let framework: 'vitest' | 'jest' | 'mocha' | 'playwright' | undefined;
        if (deps.vitest) framework = 'vitest';
        else if (deps.jest) framework = 'jest';
        else if (deps.mocha) framework = 'mocha';
        else if (deps['@playwright/test']) framework = 'playwright';

        const hasTests = framework !== undefined;

        // Try to detect test files
        const testFiles = await this.findFiles('**/*.{test,spec}.{ts,tsx,js,jsx}');

        return {
            hasTests: hasTests || testFiles.length > 0,
            framework,
            coverage: undefined // TODO: Parse coverage reports
        };
    }

    /**
     * Find React components
     */
    private async findComponents(): Promise<ComponentInfo[]> {
        const componentFiles = await this.findFiles('**/src/**/*.{tsx,jsx}');
        const components: ComponentInfo[] = [];

        for (const file of componentFiles) {
            const content = fs.readFileSync(file, 'utf-8');

            // Skip test files
            if (file.includes('.test.') || file.includes('.spec.')) continue;

            // Look for component patterns
            const componentMatch = content.match(/(?:export\s+(?:default\s+)?(?:const|function)\s+(\w+)|function\s+(\w+)\s*\([^)]*\)\s*{)/);
            if (componentMatch) {
                const name = componentMatch[1] || componentMatch[2];

                // Determine type based on location
                let type: ComponentInfo['type'] = 'component';
                if (file.includes('/pages/') || file.includes('/routes/')) type = 'page';
                if (file.includes('/layouts/')) type = 'layout';

                components.push({
                    name,
                    filePath: path.relative(this.workspaceRoot, file),
                    props: this.extractProps(content),
                    hooks: this.extractHooks(content),
                    exports: this.extractExports(content),
                    type
                });
            }
        }

        return components;
    }

    /**
     * Find API endpoints
     */
    private async findAPIEndpoints(): Promise<APIEndpoint[]> {
        const apiFiles = await this.findFiles('**/api/**/*.{ts,js}');
        const endpoints: APIEndpoint[] = [];

        for (const file of apiFiles) {
            const content = fs.readFileSync(file, 'utf-8');

            // Look for HTTP method handlers
            const methods = ['get', 'post', 'put', 'delete', 'patch'];
            for (const method of methods) {
                const regex = new RegExp(`(?:app|router)\\.${method}\\(['"\`]([^'"\`]+)['"\`]`, 'g');
                let match;
                while ((match = regex.exec(content)) !== null) {
                    endpoints.push({
                        path: match[1],
                        method: method.toUpperCase(),
                        filePath: path.relative(this.workspaceRoot, file),
                        handler: `${method}Handler`,
                        params: []
                    });
                }
            }
        }

        return endpoints;
    }

    /**
     * Find utility functions
     */
    private async findUtilities(): Promise<UtilityFunction[]> {
        const utilFiles = await this.findFiles('**/utils/**/*.{ts,js}', '**/lib/**/*.{ts,js}');
        const utilities: UtilityFunction[] = [];

        for (const file of utilFiles) {
            const content = fs.readFileSync(file, 'utf-8');

            // Find exported functions
            const funcMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g);
            for (const match of funcMatches) {
                utilities.push({
                    name: match[1],
                    filePath: path.relative(this.workspaceRoot, file),
                    params: match[2].split(',').map(p => p.trim()).filter(Boolean)
                });
            }

            // Arrow functions
            const arrowMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g);
            for (const match of arrowMatches) {
                utilities.push({
                    name: match[1],
                    filePath: path.relative(this.workspaceRoot, file),
                    params: match[2].split(',').map(p => p.trim()).filter(Boolean)
                });
            }
        }

        return utilities;
    }

    /**
     * Find database models
     */
    private async findModels(): Promise<DatabaseModel[]> {
        const modelFiles = await this.findFiles('**/models/**/*.{ts,js}', '**/db/**/*.{ts,js}');
        const models: DatabaseModel[] = [];

        // This is a simplified version - would need more sophisticated parsing
        for (const file of modelFiles) {
            const content = fs.readFileSync(file, 'utf-8');
            const name = path.basename(file, path.extname(file));

            models.push({
                name,
                filePath: path.relative(this.workspaceRoot, file),
                fields: [],
                operations: []
            });
        }

        return models;
    }

    /**
     * Helper: Find files matching glob patterns
     */
    private async findFiles(...patterns: string[]): Promise<string[]> {
        const files: string[] = [];

        for (const pattern of patterns) {
            const results = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            files.push(...results.map(uri => uri.fsPath));
        }

        return files;
    }

    /**
     * Extract props from component
     */
    private extractProps(content: string): string[] {
        const props: string[] = [];

        // Look for Props interface/type
        const propsMatch = content.match(/(?:interface|type)\s+\w+Props\s*=?\s*{([^}]+)}/);
        if (propsMatch) {
            const propsBody = propsMatch[1];
            const propMatches = propsBody.matchAll(/(\w+)[\?:]?\s*:/g);
            for (const match of propMatches) {
                props.push(match[1]);
            }
        }

        return props;
    }

    /**
     * Extract React hooks used
     */
    private extractHooks(content: string): string[] {
        const hooks = new Set<string>();
        const hookMatches = content.matchAll(/use(\w+)/g);

        for (const match of hookMatches) {
            hooks.add(`use${match[1]}`);
        }

        return Array.from(hooks);
    }

    /**
     * Extract exports
     */
    private extractExports(content: string): string[] {
        const exports: string[] = [];

        const exportMatches = content.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g);
        for (const match of exportMatches) {
            exports.push(match[1]);
        }

        if (content.includes('export default')) {
            exports.push('default');
        }

        return exports;
    }

    /**
     * Generate summary report
     */
    generateReport(structure: CodebaseStructure): string {
        const lines: string[] = [
            '# Codebase Analysis Report',
            '',
            '## Stack',
            `- Frontend: ${structure.framework}`,
            `- Backend: ${structure.backend}`,
            `- Database: ${structure.database}`,
            '',
            '## Testing',
            `- Has Tests: ${structure.testing.hasTests ? 'Yes' : 'No'}`,
            `- Framework: ${structure.testing.framework || 'None'}`,
            '',
            '## Components',
            `- Total: ${structure.components.length}`,
            `- Pages: ${structure.components.filter(c => c.type === 'page').length}`,
            `- Components: ${structure.components.filter(c => c.type === 'component').length}`,
            '',
            '## API Endpoints',
            `- Total: ${structure.apiEndpoints.length}`,
            ...structure.apiEndpoints.map(e => `  - ${e.method} ${e.path}`),
            '',
            '## Utilities',
            `- Total: ${structure.utilities.length}`,
            '',
            '## Test Coverage Gaps',
            `- Components without tests: ${structure.components.length}`,
            `- API endpoints without tests: ${structure.apiEndpoints.length}`,
            `- Utilities without tests: ${structure.utilities.length}`
        ];

        return lines.join('\n');
    }
}
