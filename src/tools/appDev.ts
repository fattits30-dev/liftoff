/**
 * App Development Tools for Liftoff Agents
 * 
 * Provides project scaffolding, dev server management, 
 * framework detection, and common app development workflows.
 */

import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type Framework = 
    | 'react' | 'next' | 'vue' | 'nuxt' | 'svelte' | 'sveltekit'
    | 'express' | 'fastify' | 'nest' | 'hono'
    | 'django' | 'flask' | 'fastapi'
    | 'unknown';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface ProjectInfo {
    framework: Framework;
    packageManager: PackageManager;
    hasTypeScript: boolean;
    hasTailwind: boolean;
    hasTests: boolean;
    testFramework?: string;
    devCommand?: string;
    buildCommand?: string;
    testCommand?: string;
    ports: number[];
}

export interface DevServer {
    id: string;
    name: string;
    command: string;
    port: number;
    process: ChildProcess | null;
    status: 'stopped' | 'starting' | 'running' | 'error';
    logs: string[];
    startTime?: Date;
}

// ============================================================================
// Project Detection
// ============================================================================

export async function detectProjectInfo(workspaceRoot: string): Promise<ProjectInfo> {
    const info: ProjectInfo = {
        framework: 'unknown',
        packageManager: 'npm',
        hasTypeScript: false,
        hasTailwind: false,
        hasTests: false,
        ports: []
    };

    try {
        // Detect package manager
        if (await fileExists(path.join(workspaceRoot, 'bun.lockb'))) {
            info.packageManager = 'bun';
        } else if (await fileExists(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
            info.packageManager = 'pnpm';
        } else if (await fileExists(path.join(workspaceRoot, 'yarn.lock'))) {
            info.packageManager = 'yarn';
        }

        // Read package.json
        const pkgPath = path.join(workspaceRoot, 'package.json');
        if (await fileExists(pkgPath)) {
            const pkg = JSON.parse(await fsPromises.readFile(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Detect framework
            if (deps['next']) info.framework = 'next';
            else if (deps['nuxt']) info.framework = 'nuxt';
            else if (deps['@sveltejs/kit']) info.framework = 'sveltekit';
            else if (deps['svelte']) info.framework = 'svelte';
            else if (deps['vue']) info.framework = 'vue';
            else if (deps['react']) info.framework = 'react';
            else if (deps['@nestjs/core']) info.framework = 'nest';
            else if (deps['fastify']) info.framework = 'fastify';
            else if (deps['hono']) info.framework = 'hono';
            else if (deps['express']) info.framework = 'express';

            // Detect TypeScript
            info.hasTypeScript = !!deps['typescript'] || await fileExists(path.join(workspaceRoot, 'tsconfig.json'));

            // Detect Tailwind
            info.hasTailwind = !!deps['tailwindcss'];

            // Detect test framework
            if (deps['vitest']) {
                info.hasTests = true;
                info.testFramework = 'vitest';
            } else if (deps['jest']) {
                info.hasTests = true;
                info.testFramework = 'jest';
            } else if (deps['mocha']) {
                info.hasTests = true;
                info.testFramework = 'mocha';
            }

            // Extract commands from scripts
            if (pkg.scripts) {
                info.devCommand = pkg.scripts.dev || pkg.scripts.start;
                info.buildCommand = pkg.scripts.build;
                info.testCommand = pkg.scripts.test;

                // Try to detect port from scripts
                const devScript = info.devCommand || '';
                const portMatch = devScript.match(/--port[= ](\d+)|PORT=(\d+)|-p[= ]?(\d+)/);
                if (portMatch) {
                    info.ports.push(parseInt(portMatch[1] || portMatch[2] || portMatch[3]));
                }
            }
        }

        // Check for Python projects
        const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
        const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
        
        if (await fileExists(requirementsPath) || await fileExists(pyprojectPath)) {
            let content = '';
            if (await fileExists(requirementsPath)) {
                content = await fsPromises.readFile(requirementsPath, 'utf-8');
            } else if (await fileExists(pyprojectPath)) {
                content = await fsPromises.readFile(pyprojectPath, 'utf-8');
            }

            if (content.includes('django')) info.framework = 'django';
            else if (content.includes('fastapi')) info.framework = 'fastapi';
            else if (content.includes('flask')) info.framework = 'flask';

            if (content.includes('pytest')) {
                info.hasTests = true;
                info.testFramework = 'pytest';
            }
        }

        // Default ports by framework
        if (info.ports.length === 0) {
            switch (info.framework) {
                case 'next': info.ports = [3000]; break;
                case 'nuxt': info.ports = [3000]; break;
                case 'react': info.ports = [3000, 5173]; break;
                case 'vue': info.ports = [5173, 8080]; break;
                case 'svelte':
                case 'sveltekit': info.ports = [5173]; break;
                case 'express': 
                case 'fastify':
                case 'nest':
                case 'hono': info.ports = [3000, 8000]; break;
                case 'django': info.ports = [8000]; break;
                case 'flask': info.ports = [5000]; break;
                case 'fastapi': info.ports = [8000]; break;
            }
        }

    } catch (_err) {
        // Ignore errors, return defaults
    }

    return info;
}

// ============================================================================
// Dev Server Manager
// ============================================================================

export class DevServerManager {
    private servers: Map<string, DevServer> = new Map();
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Dev Servers');
    }

    async startServer(options: {
        name: string;
        command: string;
        cwd: string;
        port?: number;
        env?: Record<string, string>;
    }): Promise<DevServer> {
        const id = `server-${Date.now()}`;
        const port = options.port || await this.findAvailablePort(3000);

        // Check if port is already in use
        if (await this.isPortInUse(port)) {
            const existing = Array.from(this.servers.values()).find(s => s.port === port);
            if (existing && existing.status === 'running') {
                return existing; // Return existing server
            }
            // Kill whatever is on that port
            await this.killPort(port);
        }

        const server: DevServer = {
            id,
            name: options.name,
            command: options.command,
            port,
            process: null,
            status: 'starting',
            logs: [],
            startTime: new Date()
        };

        this.servers.set(id, server);

        // Start the process
        const [cmd, ...args] = options.command.split(' ');
        const env = { 
            ...process.env, 
            ...options.env,
            PORT: String(port),
            NODE_ENV: 'development'
        };

        try {
            server.process = spawn(cmd, args, {
                cwd: options.cwd,
                env,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            server.process.stdout?.on('data', (data) => {
                const log = data.toString();
                server.logs.push(log);
                if (server.logs.length > 500) server.logs.shift();
                this.outputChannel.appendLine(`[${server.name}] ${log}`);

                // Detect when server is ready
                if (log.includes('ready') || log.includes('started') || log.includes('listening')) {
                    server.status = 'running';
                }
            });

            server.process.stderr?.on('data', (data) => {
                const log = data.toString();
                server.logs.push(`[ERR] ${log}`);
                this.outputChannel.appendLine(`[${server.name}] ERR: ${log}`);
            });

            server.process.on('exit', (code) => {
                server.status = code === 0 ? 'stopped' : 'error';
                server.process = null;
                this.outputChannel.appendLine(`[${server.name}] Exited with code ${code}`);
            });

            // Wait for server to start (max 30 seconds)
            await this.waitForPort(port, 30000);
            server.status = 'running';

        } catch (err: any) {
            server.status = 'error';
            server.logs.push(`Error: ${err.message}`);
        }

        return server;
    }

    stopServer(id: string): boolean {
        const server = this.servers.get(id);
        if (!server || !server.process) return false;

        server.process.kill('SIGTERM');
        server.status = 'stopped';
        return true;
    }

    stopAllServers(): void {
        for (const server of this.servers.values()) {
            if (server.process) {
                server.process.kill('SIGTERM');
                server.status = 'stopped';
            }
        }
    }

    getServer(id: string): DevServer | undefined {
        return this.servers.get(id);
    }

    getServerByPort(port: number): DevServer | undefined {
        return Array.from(this.servers.values()).find(s => s.port === port);
    }

    getAllServers(): DevServer[] {
        return Array.from(this.servers.values());
    }

    getRunningServers(): DevServer[] {
        return Array.from(this.servers.values()).filter(s => s.status === 'running');
    }

    private async isPortInUse(port: number): Promise<boolean> {
        try {
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                return stdout.trim().length > 0;
            } else {
                const { stdout } = await execAsync(`lsof -i :${port}`);
                return stdout.trim().length > 0;
            }
        } catch {
            return false;
        }
    }

    private async killPort(port: number): Promise<void> {
        try {
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                const lines = stdout.split('\n').filter(l => l.includes('LISTENING'));
                for (const line of lines) {
                    const pid = line.trim().split(/\s+/).pop();
                    if (pid) {
                        await execAsync(`taskkill /PID ${pid} /F`).catch(() => {});
                    }
                }
            } else {
                await execAsync(`lsof -ti :${port} | xargs kill -9`).catch(() => {});
            }
        } catch {
            // Ignore errors
        }
    }

    private async findAvailablePort(startPort: number): Promise<number> {
        let port = startPort;
        while (await this.isPortInUse(port)) {
            port++;
            if (port > startPort + 100) {
                throw new Error('No available ports found');
            }
        }
        return port;
    }

    private async waitForPort(port: number, timeout: number): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (await this.isPortInUse(port)) {
                return;
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }

    dispose(): void {
        this.stopAllServers();
        this.outputChannel.dispose();
    }
}

// ============================================================================
// Project Templates
// ============================================================================

export interface ProjectTemplate {
    name: string;
    description: string;
    framework: Framework;
    files: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
    postInstall?: string[];
}

export const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = {
    'react-ts': {
        name: 'React + TypeScript',
        description: 'Modern React app with TypeScript and Vite',
        framework: 'react',
        files: {
            'src/App.tsx': `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Hello Liftoff!</h1>
        <button 
          onClick={() => setCount(c => c + 1)}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Count: {count}
        </button>
      </div>
    </div>
  )
}`,
            'src/main.tsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`,
            'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
            'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Liftoff App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
            'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}`,
            'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})`,
            'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: []
}`,
            'postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}`
        },
        dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0'
        },
        devDependencies: {
            '@types/react': '^18.2.0',
            '@types/react-dom': '^18.2.0',
            '@vitejs/plugin-react': '^4.0.0',
            'typescript': '^5.0.0',
            'vite': '^5.0.0',
            'tailwindcss': '^3.4.0',
            'postcss': '^8.4.0',
            'autoprefixer': '^10.4.0',
            'vitest': '^1.0.0',
            '@testing-library/react': '^14.0.0'
        },
        scripts: {
            'dev': 'vite',
            'build': 'tsc && vite build',
            'preview': 'vite preview',
            'test': 'vitest'
        }
    },

    'next-ts': {
        name: 'Next.js + TypeScript',
        description: 'Full-stack Next.js app with App Router',
        framework: 'next',
        files: {
            'app/page.tsx': `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold">Welcome to Liftoff!</h1>
    </main>
  )
}`,
            'app/layout.tsx': `import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Liftoff App',
  description: 'Built with Liftoff'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}`,
            'app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
            'tsconfig.json': `{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
            'tailwind.config.ts': `import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: []
}
export default config`,
            'next.config.js': `/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig`
        },
        dependencies: {
            'next': '^14.0.0',
            'react': '^18.2.0',
            'react-dom': '^18.2.0'
        },
        devDependencies: {
            '@types/node': '^20.0.0',
            '@types/react': '^18.2.0',
            '@types/react-dom': '^18.2.0',
            'typescript': '^5.0.0',
            'tailwindcss': '^3.4.0',
            'postcss': '^8.4.0',
            'autoprefixer': '^10.4.0'
        },
        scripts: {
            'dev': 'next dev',
            'build': 'next build',
            'start': 'next start',
            'lint': 'next lint'
        }
    },

    'express-ts': {
        name: 'Express + TypeScript',
        description: 'REST API with Express and TypeScript',
        framework: 'express',
        files: {
            'src/index.ts': `import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Liftoff!' })
})

app.listen(PORT, () => {
  console.log(\`🚀 Server running on http://localhost:\${PORT}\`)
})`,
            'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}`
        },
        dependencies: {
            'express': '^4.18.0',
            'cors': '^2.8.0'
        },
        devDependencies: {
            '@types/express': '^4.17.0',
            '@types/cors': '^2.8.0',
            '@types/node': '^20.0.0',
            'typescript': '^5.0.0',
            'ts-node': '^10.9.0',
            'nodemon': '^3.0.0',
            'vitest': '^1.0.0'
        },
        scripts: {
            'dev': 'nodemon --exec ts-node src/index.ts',
            'build': 'tsc',
            'start': 'node dist/index.js',
            'test': 'vitest'
        }
    }
};

// Import additional templates
import { ADDITIONAL_TEMPLATES, DatabaseTools, DeploymentTools, EnvManager } from './appDevExtended';

// Merge all templates
export const ALL_TEMPLATES: Record<string, ProjectTemplate> = {
    ...PROJECT_TEMPLATES,
    ...ADDITIONAL_TEMPLATES
};

// Re-export tools
export { DatabaseTools, DeploymentTools, EnvManager };

// ============================================================================
// Scaffold Project
// ============================================================================

export async function scaffoldProject(
    workspaceRoot: string,
    templateName: string,
    projectName: string
): Promise<{ success: boolean; message: string }> {
    const template = ALL_TEMPLATES[templateName];
    if (!template) {
        const available = Object.keys(ALL_TEMPLATES).join(', ');
        return { success: false, message: `Unknown template: ${templateName}. Available: ${available}` };
    }

    const projectDir = path.join(workspaceRoot, projectName);

    try {
        // Create project directory
        await fsPromises.mkdir(projectDir, { recursive: true });

        // Create package.json
        const pkg = {
            name: projectName,
            version: '0.1.0',
            private: true,
            scripts: template.scripts,
            dependencies: template.dependencies,
            devDependencies: template.devDependencies
        };
        await fsPromises.writeFile(
            path.join(projectDir, 'package.json'),
            JSON.stringify(pkg, null, 2)
        );

        // Create all template files
        for (const [filePath, content] of Object.entries(template.files)) {
            const fullPath = path.join(projectDir, filePath);
            await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
            await fsPromises.writeFile(fullPath, content);
        }

        // Create .gitignore
        await fsPromises.writeFile(
            path.join(projectDir, '.gitignore'),
            `node_modules\ndist\n.next\n.env\n.env.local\n*.log\n`
        );

        return {
            success: true,
            message: `Created ${template.name} project at ${projectDir}\n\nNext steps:\n1. cd ${projectName}\n2. npm install\n3. npm run dev`
        };

    } catch (err: any) {
        return { success: false, message: `Failed to scaffold: ${err.message}` };
    }
}

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// App Dev System Prompt Additions
// ============================================================================

export function getAppDevPromptSection(projectInfo: ProjectInfo): string {
    const pmCmd = projectInfo.packageManager === 'npm' ? 'npm run' : projectInfo.packageManager;
    
    return `
# Project Context
- Framework: ${projectInfo.framework}
- Package Manager: ${projectInfo.packageManager}
- TypeScript: ${projectInfo.hasTypeScript ? 'Yes' : 'No'}
- Tailwind: ${projectInfo.hasTailwind ? 'Yes' : 'No'}
- Tests: ${projectInfo.hasTests ? `Yes (${projectInfo.testFramework})` : 'No'}
- Dev Command: ${projectInfo.devCommand || 'npm run dev'}
- Test Command: ${projectInfo.testCommand || 'npm test'}
- Expected Ports: ${projectInfo.ports.join(', ')}

# Dev Server Commands
- Start: shell.run('${pmCmd} dev')
- Build: shell.run('${pmCmd} build')
- Test: shell.run('${pmCmd} test')

# Port Management
If you see "port already in use":
1. DON'T try to start another server
2. The app is ALREADY running
3. Just use browser.navigate('http://localhost:${projectInfo.ports[0] || 3000}')

# Framework Patterns
${getFrameworkPatterns(projectInfo.framework)}
`;
}

function getFrameworkPatterns(framework: Framework): string {
    const patterns: Record<Framework, string> = {
        'react': `React patterns:
- Components in src/components/
- Hooks in src/hooks/
- State: useState, useReducer, or Zustand/Jotai
- Styling: Tailwind or CSS modules`,
        
        'next': `Next.js patterns:
- Pages in app/ (App Router) or pages/ (Pages Router)
- API routes in app/api/ or pages/api/
- Server components by default
- 'use client' for client components
- Server actions for mutations`,
        
        'vue': `Vue patterns:
- Components in src/components/
- Composables in src/composables/
- Pinia for state management
- <script setup> syntax preferred`,
        
        'nuxt': `Nuxt patterns:
- Pages in pages/
- Components auto-imported from components/
- Composables in composables/
- Server routes in server/api/`,
        
        'express': `Express patterns:
- Routes in src/routes/
- Middleware in src/middleware/
- Controllers in src/controllers/
- Models in src/models/`,
        
        'fastify': `Fastify patterns:
- Plugins in src/plugins/
- Routes in src/routes/
- Schemas for validation`,
        
        'nest': `NestJS patterns:
- Modules in src/modules/
- Controllers, Services, DTOs
- Dependency injection
- Decorators for routes`,
        
        'django': `Django patterns:
- Apps in apps/
- Models in models.py
- Views in views.py
- URLs in urls.py`,
        
        'flask': `Flask patterns:
- Blueprints for organization
- Routes with decorators
- Templates in templates/`,
        
        'fastapi': `FastAPI patterns:
- Routers in routers/
- Pydantic models for validation
- Dependency injection
- Async by default`,
        
        'svelte': `Svelte patterns:
- Components in src/lib/
- Stores for state
- +page.svelte for routes (SvelteKit)`,
        
        'sveltekit': `SvelteKit patterns:
- Routes in src/routes/
- +page.svelte, +layout.svelte
- +server.ts for API endpoints
- Load functions for data`,
        
        'hono': `Hono patterns:
- Lightweight Express alternative
- Middleware-based
- Works on edge runtimes`,
        
        'unknown': `General patterns:
- Follow existing code structure
- Read package.json for available scripts
- Check for README for project-specific info`
    };

    return patterns[framework] || patterns['unknown'];
}
