/**
 * Standalone test script for CodebaseAnalyzer
 * Tests the analyzer without requiring VS Code
 */

const fs = require('fs');
const path = require('path');

// Simplified version without vscode dependency
class CodebaseAnalyzer {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }

    async analyze() {
        const packageJson = this.readPackageJson();

        return {
            framework: this.detectFramework(packageJson),
            backend: this.detectBackend(packageJson),
            database: this.detectDatabase(packageJson),
            testing: await this.analyzeTesting(packageJson),
            components: await this.findComponents(),
            apiEndpoints: await this.findAPIEndpoints(),
            utilities: await this.findUtilities(),
            models: await this.findModels()
        };
    }

    readPackageJson() {
        const pkgPath = path.join(this.workspaceRoot, 'package.json');
        try {
            const content = fs.readFileSync(pkgPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            return { dependencies: {}, devDependencies: {} };
        }
    }

    detectFramework(packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps.react) return 'react';
        if (deps.vue) return 'vue';
        if (deps['@angular/core']) return 'angular';
        return 'unknown';
    }

    detectBackend(packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps.express) return 'express';
        if (deps.fastify) return 'fastify';
        if (deps['@nestjs/core']) return 'nest';
        return 'none';
    }

    detectDatabase(packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps['@supabase/supabase-js']) return 'supabase';
        if (deps.pg || deps.postgresql) return 'postgresql';
        if (deps.mongodb || deps.mongoose) return 'mongodb';
        if (deps['better-sqlite3'] || deps.sqlite3) return 'sqlite';
        return 'none';
    }

    async analyzeTesting(packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        let framework = undefined;
        if (deps.vitest) framework = 'vitest';
        else if (deps.jest) framework = 'jest';
        else if (deps.mocha) framework = 'mocha';
        else if (deps['@playwright/test']) framework = 'playwright';

        const testFiles = this.findFilesSync('**/*.{test,spec}.{ts,tsx,js,jsx}');
        return {
            hasTests: framework !== undefined || testFiles.length > 0,
            framework,
            testFileCount: testFiles.length
        };
    }

    async findComponents() {
        const componentFiles = this.findFilesSync('**/src/**/*.{tsx,jsx}');
        const components = [];

        for (const file of componentFiles) {
            if (file.includes('.test.') || file.includes('.spec.')) continue;
            if (file.includes('node_modules')) continue;

            const content = fs.readFileSync(file, 'utf-8');
            const componentMatch = content.match(/(?:export\s+(?:default\s+)?(?:const|function)\s+(\w+)|function\s+(\w+)\s*\([^)]*\)\s*{)/);

            if (componentMatch) {
                const name = componentMatch[1] || componentMatch[2];
                let type = 'component';
                if (file.includes('/pages/') || file.includes('/routes/')) type = 'page';
                if (file.includes('/layouts/')) type = 'layout';

                components.push({
                    name,
                    filePath: path.relative(this.workspaceRoot, file),
                    type
                });
            }
        }

        return components;
    }

    async findAPIEndpoints() {
        const apiFiles = this.findFilesSync('**/api/**/*.{ts,js}', '**/server/**/*.{ts,js}', '**/routes/**/*.{ts,js}');
        const endpoints = [];

        for (const file of apiFiles) {
            if (file.includes('node_modules')) continue;
            const content = fs.readFileSync(file, 'utf-8');

            const methods = ['get', 'post', 'put', 'delete', 'patch'];
            for (const method of methods) {
                const regex = new RegExp(`(?:app|router)\\.${method}\\(['"\`]([^'"\`]+)['"\`]`, 'g');
                let match;
                while ((match = regex.exec(content)) !== null) {
                    endpoints.push({
                        path: match[1],
                        method: method.toUpperCase(),
                        filePath: path.relative(this.workspaceRoot, file)
                    });
                }
            }
        }

        return endpoints;
    }

    async findUtilities() {
        const utilFiles = this.findFilesSync('**/utils/**/*.{ts,js}', '**/lib/**/*.{ts,js}', '**/helpers/**/*.{ts,js}');
        const utilities = [];

        for (const file of utilFiles) {
            if (file.includes('node_modules')) continue;
            if (file.includes('.test.') || file.includes('.spec.')) continue;

            const content = fs.readFileSync(file, 'utf-8');
            const funcMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g);

            for (const match of funcMatches) {
                utilities.push({
                    name: match[1],
                    filePath: path.relative(this.workspaceRoot, file)
                });
            }

            const arrowMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g);
            for (const match of arrowMatches) {
                utilities.push({
                    name: match[1],
                    filePath: path.relative(this.workspaceRoot, file)
                });
            }
        }

        return utilities;
    }

    async findModels() {
        const modelFiles = this.findFilesSync('**/models/**/*.{ts,js}', '**/db/**/*.{ts,js}');
        const models = [];

        for (const file of modelFiles) {
            if (file.includes('node_modules')) continue;
            const name = path.basename(file, path.extname(file));
            models.push({
                name,
                filePath: path.relative(this.workspaceRoot, file)
            });
        }

        return models;
    }

    findFilesSync(...patterns) {
        const files = [];

        const walkDir = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
                            walkDir(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const relPath = path.relative(this.workspaceRoot, fullPath);
                        for (const pattern of patterns) {
                            if (this.matchesPattern(relPath, pattern)) {
                                files.push(fullPath);
                                break;
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignore permission errors
            }
        };

        walkDir(this.workspaceRoot);
        return files;
    }

    matchesPattern(filePath, pattern) {
        // Normalize paths for Windows
        filePath = filePath.replace(/\\/g, '/');
        pattern = pattern.replace(/\\/g, '/');

        // Convert glob pattern to regex
        let regex = pattern
            .replace(/\./g, '§DOT§') // Escape dots FIRST (before creating regex)
            .replace(/\*\*/g, '§GLOBSTAR§') // Placeholder for **
            .replace(/\*/g, '[^/]*') // Single * matches anything except /
            .replace(/§GLOBSTAR§\//g, '(.*/)?' ) // **/ at start matches 0+ dirs
            .replace(/\/§GLOBSTAR§/g, '(/.*)?') // /** at end matches 0+ dirs
            .replace(/§GLOBSTAR§/g, '.*') // Remaining ** matches anything
            .replace(/§DOT§/g, '\\.') // Replace literal dots with escaped version
            .replace(/{([^}]+)}/g, (match, p1) => `(${p1.replace(/,/g, '|')})`); // {a,b} → (a|b)

        return new RegExp(`^${regex}$`).test(filePath);
    }
}

// Run the test
const workspaceRoot = process.argv[2] || process.cwd();

console.log('🧪 Testing CodebaseAnalyzer...');
console.log('📁 Workspace:', workspaceRoot);
console.log('');

const analyzer = new CodebaseAnalyzer(workspaceRoot);
analyzer.analyze().then(structure => {
    console.log('✅ Analysis Complete!');
    console.log('');
    console.log('📊 Results:');
    console.log('  Frontend:', structure.framework);
    console.log('  Backend:', structure.backend);
    console.log('  Database:', structure.database);
    console.log('  Testing:', structure.testing.hasTests ? `Yes (${structure.testing.framework})` : 'No');
    console.log('');
    console.log('📦 Found:');
    console.log('  Components:', structure.components.length);
    console.log('    - Pages:', structure.components.filter(c => c.type === 'page').length);
    console.log('    - Layouts:', structure.components.filter(c => c.type === 'layout').length);
    console.log('    - Components:', structure.components.filter(c => c.type === 'component').length);
    console.log('  API Endpoints:', structure.apiEndpoints.length);
    console.log('  Utilities:', structure.utilities.length);
    console.log('  Models:', structure.models.length);
    console.log('  Test Files:', structure.testing.testFileCount || 0);
    console.log('');

    if (structure.components.length > 0) {
        console.log('🎨 Sample Components:');
        structure.components.slice(0, 5).forEach(c => {
            console.log(`  - ${c.name} (${c.type}) - ${c.filePath}`);
        });
        console.log('');
    }

    if (structure.apiEndpoints.length > 0) {
        console.log('🔌 Sample API Endpoints:');
        structure.apiEndpoints.slice(0, 5).forEach(e => {
            console.log(`  - ${e.method} ${e.path} - ${e.filePath}`);
        });
        console.log('');
    }

    if (structure.utilities.length > 0) {
        console.log('🔧 Sample Utilities:');
        structure.utilities.slice(0, 5).forEach(u => {
            console.log(`  - ${u.name} - ${u.filePath}`);
        });
        console.log('');
    }

    console.log('✅ Test generation would create approximately:');
    const unitTests = structure.components.length + structure.utilities.length;
    const apiTests = structure.apiEndpoints.length;
    const e2eTests = structure.components.filter(c => c.type === 'page').length > 0 ? 3 : 0;
    console.log(`  - ${unitTests} unit test files`);
    console.log(`  - ${apiTests} API test files`);
    console.log(`  - ${e2eTests} E2E test suites`);
    console.log(`  - Total: ${unitTests + apiTests + e2eTests} test files`);

}).catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
});
