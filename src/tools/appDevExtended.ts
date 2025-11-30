/**
 * App Development Tools for Liftoff Agents - Part 2
 * 
 * Additional templates, database tools, deployment, environment management
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { Framework, ProjectTemplate } from './appDev';

const execAsync = promisify(exec);

// ============================================================================
// Additional Project Templates
// ============================================================================

export const ADDITIONAL_TEMPLATES: Record<string, ProjectTemplate> = {
    'vue-ts': {
        name: 'Vue 3 + TypeScript',
        description: 'Modern Vue 3 app with Composition API and Vite',
        framework: 'vue' as Framework,
        files: {
            'src/App.vue': `<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="text-center">
      <h1 class="text-4xl font-bold mb-4">Hello Liftoff!</h1>
      <button 
        @click="count++"
        class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Count: {{ count }}
      </button>
    </div>
  </div>
</template>`,
            'src/main.ts': `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')`,
            'src/style.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
            'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Liftoff Vue App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`,
            'vite.config.ts': `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()]
})`,
            'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"]
}`,
            'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
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
            'vue': '^3.4.0'
        },
        devDependencies: {
            '@vitejs/plugin-vue': '^5.0.0',
            'typescript': '^5.0.0',
            'vite': '^5.0.0',
            'vue-tsc': '^1.8.0',
            'tailwindcss': '^3.4.0',
            'postcss': '^8.4.0',
            'autoprefixer': '^10.4.0',
            'vitest': '^1.0.0',
            '@vue/test-utils': '^2.4.0'
        },
        scripts: {
            'dev': 'vite',
            'build': 'vue-tsc && vite build',
            'preview': 'vite preview',
            'test': 'vitest'
        }
    },

    'svelte-ts': {
        name: 'SvelteKit + TypeScript',
        description: 'Full-stack SvelteKit app with TypeScript',
        framework: 'sveltekit' as Framework,
        files: {
            'src/routes/+page.svelte': `<script lang="ts">
  let count = 0;
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-100">
  <div class="text-center">
    <h1 class="text-4xl font-bold mb-4">Hello Liftoff!</h1>
    <button 
      on:click={() => count++}
      class="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
    >
      Count: {count}
    </button>
  </div>
</div>`,
            'src/routes/+layout.svelte': `<script>
  import '../app.css';
</script>

<slot />`,
            'src/app.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
            'src/app.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>`,
            'svelte.config.js': `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
};

export default config;`,
            'vite.config.ts': `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()]
});`,
            'tsconfig.json': `{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true
  }
}`,
            'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
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
        dependencies: {},
        devDependencies: {
            '@sveltejs/adapter-auto': '^3.0.0',
            '@sveltejs/kit': '^2.0.0',
            '@sveltejs/vite-plugin-svelte': '^3.0.0',
            'svelte': '^4.0.0',
            'svelte-check': '^3.6.0',
            'typescript': '^5.0.0',
            'vite': '^5.0.0',
            'tailwindcss': '^3.4.0',
            'postcss': '^8.4.0',
            'autoprefixer': '^10.4.0',
            'vitest': '^1.0.0',
            '@testing-library/svelte': '^4.0.0'
        },
        scripts: {
            'dev': 'vite dev',
            'build': 'vite build',
            'preview': 'vite preview',
            'test': 'vitest',
            'check': 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json'
        }
    },

    'fastapi': {
        name: 'FastAPI + Python',
        description: 'Modern Python API with FastAPI and async support',
        framework: 'fastapi' as Framework,
        files: {
            'app/main.py': `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="Liftoff API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class HealthResponse(BaseModel):
    status: str
    timestamp: datetime

class HelloResponse(BaseModel):
    message: str

@app.get("/api/health", response_model=HealthResponse)
async def health():
    return {"status": "ok", "timestamp": datetime.now()}

@app.get("/api/hello", response_model=HelloResponse)
async def hello(name: str = "World"):
    return {"message": f"Hello {name} from Liftoff!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)`,
            'app/__init__.py': '',
            'requirements.txt': `fastapi>=0.109.0
uvicorn[standard]>=0.27.0
pydantic>=2.5.0
python-dotenv>=1.0.0
pytest>=7.4.0
httpx>=0.26.0`,
            'pytest.ini': `[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
asyncio_mode = auto`,
            'tests/__init__.py': '',
            'tests/test_api.py': `import pytest
from httpx import AsyncClient
from app.main import app

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_health():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

@pytest.mark.anyio
async def test_hello():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/hello")
        assert response.status_code == 200
        assert "Hello" in response.json()["message"]`,
            '.env.example': `# Environment variables
DATABASE_URL=sqlite:///./app.db
SECRET_KEY=your-secret-key-here
DEBUG=true`
        },
        dependencies: {},
        devDependencies: {},
        scripts: {
            'dev': 'uvicorn app.main:app --reload --port 8000',
            'start': 'uvicorn app.main:app --host 0.0.0.0 --port 8000',
            'test': 'pytest -v'
        }
    },

    'flask': {
        name: 'Flask + Python',
        description: 'Classic Python web framework with Flask',
        framework: 'flask' as Framework,
        files: {
            'app/__init__.py': `from flask import Flask
from flask_cors import CORS

def create_app():
    app = Flask(__name__)
    CORS(app)
    
    from app.routes import main
    app.register_blueprint(main)
    
    return app`,
            'app/routes.py': `from flask import Blueprint, jsonify
from datetime import datetime

main = Blueprint('main', __name__)

@main.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })

@main.route('/api/hello')
@main.route('/api/hello/<name>')
def hello(name='World'):
    return jsonify({
        'message': f'Hello {name} from Liftoff!'
    })`,
            'run.py': `from app import create_app

app = create_app()

if __name__ == '__main__':
    app.run(debug=True, port=5000)`,
            'requirements.txt': `flask>=3.0.0
flask-cors>=4.0.0
python-dotenv>=1.0.0
pytest>=7.4.0
pytest-flask>=1.3.0`,
            'pytest.ini': `[pytest]
testpaths = tests
python_files = test_*.py`,
            'tests/__init__.py': '',
            'tests/conftest.py': `import pytest
from app import create_app

@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    return app

@pytest.fixture
def client(app):
    return app.test_client()`,
            'tests/test_routes.py': `def test_health(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json['status'] == 'ok'

def test_hello(client):
    response = client.get('/api/hello')
    assert response.status_code == 200
    assert 'Hello' in response.json['message']

def test_hello_name(client):
    response = client.get('/api/hello/Liftoff')
    assert response.status_code == 200
    assert 'Liftoff' in response.json['message']`,
            '.env.example': `FLASK_APP=run.py
FLASK_DEBUG=1
SECRET_KEY=your-secret-key`
        },
        dependencies: {},
        devDependencies: {},
        scripts: {
            'dev': 'flask run --debug',
            'start': 'flask run --host=0.0.0.0',
            'test': 'pytest -v'
        }
    },

    'fullstack-next': {
        name: 'Full-Stack Next.js',
        description: 'Next.js with Prisma, tRPC, and authentication',
        framework: 'next' as Framework,
        files: {
            'app/page.tsx': `import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold mb-8">Welcome to Liftoff!</h1>
      <p className="text-xl text-gray-600 mb-8">Full-stack Next.js starter</p>
      <div className="flex gap-4">
        <Link 
          href="/api/health"
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          API Health
        </Link>
      </div>
    </main>
  )
}`,
            'app/layout.tsx': `import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Liftoff Full-Stack',
  description: 'Built with Next.js, Prisma, and more'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">{children}</body>
    </html>
  )
}`,
            'app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
            'app/api/health/route.ts': `import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'connected' // TODO: actual db check
  })
}`,
            'prisma/schema.prisma': `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`,
            'lib/prisma.ts': `import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma`,
            '.env': `DATABASE_URL="file:./dev.db"`,
            '.env.example': `DATABASE_URL="file:./dev.db"
# DATABASE_URL="postgresql://user:password@localhost:5432/mydb"`,
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
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
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
            'react-dom': '^18.2.0',
            '@prisma/client': '^5.0.0'
        },
        devDependencies: {
            '@types/node': '^20.0.0',
            '@types/react': '^18.2.0',
            '@types/react-dom': '^18.2.0',
            'typescript': '^5.0.0',
            'tailwindcss': '^3.4.0',
            'postcss': '^8.4.0',
            'autoprefixer': '^10.4.0',
            'prisma': '^5.0.0'
        },
        scripts: {
            'dev': 'next dev',
            'build': 'next build',
            'start': 'next start',
            'lint': 'next lint',
            'db:push': 'prisma db push',
            'db:studio': 'prisma studio',
            'db:generate': 'prisma generate'
        },
        postInstall: ['npx prisma generate', 'npx prisma db push']
    }
};

// ============================================================================
// Database Tools
// ============================================================================

export interface DatabaseConfig {
    type: 'sqlite' | 'postgres' | 'mysql';
    connectionString: string;
}

export class DatabaseTools {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Detect database configuration from project
     */
    async detectDatabase(): Promise<DatabaseConfig | null> {
        // Check for Prisma
        const prismaPath = path.join(this.workspaceRoot, 'prisma', 'schema.prisma');
        if (await this.fileExists(prismaPath)) {
            const schema = await fsPromises.readFile(prismaPath, 'utf-8');
            const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/);
            const urlMatch = schema.match(/url\s*=\s*env\("(\w+)"\)/);
            
            if (providerMatch) {
                const provider = providerMatch[1] as 'sqlite' | 'postgresql' | 'mysql';
                const envVar = urlMatch?.[1] || 'DATABASE_URL';
                const connString = process.env[envVar] || '';
                
                return {
                    type: provider === 'postgresql' ? 'postgres' : provider as any,
                    connectionString: connString
                };
            }
        }

        // Check for .env DATABASE_URL
        const envPath = path.join(this.workspaceRoot, '.env');
        if (await this.fileExists(envPath)) {
            const env = await fsPromises.readFile(envPath, 'utf-8');
            const dbUrl = env.match(/DATABASE_URL\s*=\s*["']?([^"'\n]+)/);
            if (dbUrl) {
                const url = dbUrl[1];
                if (url.includes('sqlite')) return { type: 'sqlite', connectionString: url };
                if (url.includes('postgres')) return { type: 'postgres', connectionString: url };
                if (url.includes('mysql')) return { type: 'mysql', connectionString: url };
            }
        }

        return null;
    }

    /**
     * Run Prisma commands
     */
    async prisma(command: 'generate' | 'push' | 'migrate' | 'studio' | 'seed', args?: string): Promise<string> {
        const cmd = args ? `npx prisma ${command} ${args}` : `npx prisma ${command}`;
        try {
            const { stdout, stderr } = await execAsync(cmd, { 
                cwd: this.workspaceRoot,
                timeout: 60000 
            });
            return stdout || stderr;
        } catch (err: any) {
            return `Error: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`;
        }
    }

    /**
     * Create a migration
     */
    async createMigration(name: string): Promise<string> {
        return this.prisma('migrate', `dev --name ${name}`);
    }

    /**
     * Run migrations
     */
    async runMigrations(): Promise<string> {
        return this.prisma('migrate', 'deploy');
    }

    /**
     * Generate Prisma client
     */
    async generateClient(): Promise<string> {
        return this.prisma('generate');
    }

    /**
     * Open Prisma Studio
     */
    async openStudio(): Promise<string> {
        // Run in background
        spawn('npx', ['prisma', 'studio'], {
            cwd: this.workspaceRoot,
            detached: true,
            stdio: 'ignore'
        }).unref();
        return 'Prisma Studio opening on http://localhost:5555';
    }

    /**
     * Execute raw SQL (SQLite only for now)
     */
    async query(sql: string): Promise<string> {
        const config = await this.detectDatabase();
        if (!config) return 'No database configured';

        if (config.type === 'sqlite') {
            const dbPath = config.connectionString.replace('file:', '').replace('./', '');
            const fullPath = path.join(this.workspaceRoot, dbPath);
            try {
                const { stdout } = await execAsync(`sqlite3 "${fullPath}" "${sql}"`, {
                    cwd: this.workspaceRoot
                });
                return stdout || 'Query executed';
            } catch (err: any) {
                return `SQL Error: ${err.message}`;
            }
        }

        return `Raw SQL not supported for ${config.type} yet. Use Prisma Client instead.`;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fsPromises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

// ============================================================================
// Deployment Tools
// ============================================================================

export class DeploymentTools {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Generate Dockerfile
     */
    async generateDockerfile(type: 'node' | 'python' | 'next' = 'node'): Promise<string> {
        const dockerfiles: Record<string, string> = {
            'node': `FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]`,

            'next': `FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]`,

            'python': `FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Create non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`
        };

        const content = dockerfiles[type] || dockerfiles['node'];
        const dockerfilePath = path.join(this.workspaceRoot, 'Dockerfile');
        await fsPromises.writeFile(dockerfilePath, content);
        return `Created Dockerfile for ${type}`;
    }

    /**
     * Generate docker-compose.yml
     */
    async generateDockerCompose(options: {
        services?: ('app' | 'postgres' | 'redis')[];
        appPort?: number;
    } = {}): Promise<string> {
        const services = options.services || ['app'];
        const appPort = options.appPort || 3000;

        let compose = `version: '3.8'

services:`;

        if (services.includes('app')) {
            compose += `
  app:
    build: .
    ports:
      - "${appPort}:${appPort}"
    environment:
      - NODE_ENV=production
      - PORT=${appPort}${services.includes('postgres') ? '\n      - DATABASE_URL=postgresql://postgres:postgres@db:5432/app' : ''}${services.includes('redis') ? '\n      - REDIS_URL=redis://redis:6379' : ''}
    depends_on:${services.includes('postgres') ? '\n      - db' : ''}${services.includes('redis') ? '\n      - redis' : ''}`;
        }

        if (services.includes('postgres')) {
            compose += `

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=app
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"`;
        }

        if (services.includes('redis')) {
            compose += `

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"`;
        }

        if (services.includes('postgres') || services.includes('redis')) {
            compose += `

volumes:`;
            if (services.includes('postgres')) compose += `\n  postgres_data:`;
        }

        const composePath = path.join(this.workspaceRoot, 'docker-compose.yml');
        await fsPromises.writeFile(composePath, compose);
        return `Created docker-compose.yml with services: ${services.join(', ')}`;
    }

    /**
     * Generate Vercel configuration
     */
    async generateVercelConfig(): Promise<string> {
        const config = {
            "version": 2,
            "builds": [
                { "src": "package.json", "use": "@vercel/next" }
            ],
            "routes": [
                { "src": "/api/(.*)", "dest": "/api/$1" },
                { "src": "/(.*)", "dest": "/$1" }
            ]
        };

        const configPath = path.join(this.workspaceRoot, 'vercel.json');
        await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
        return 'Created vercel.json';
    }

    /**
     * Deploy to Vercel (requires vercel CLI)
     */
    async deployVercel(production: boolean = false): Promise<string> {
        const cmd = production ? 'vercel --prod' : 'vercel';
        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: this.workspaceRoot,
                timeout: 300000 // 5 min
            });
            return stdout || stderr;
        } catch (err: any) {
            if (err.message.includes('command not found') || err.message.includes('not recognized')) {
                return 'Vercel CLI not installed. Run: npm i -g vercel';
            }
            return `Deploy error: ${err.message}`;
        }
    }

    /**
     * Build Docker image
     */
    async buildDocker(tag: string = 'app:latest'): Promise<string> {
        try {
            const { stdout, stderr } = await execAsync(`docker build -t ${tag} .`, {
                cwd: this.workspaceRoot,
                timeout: 600000 // 10 min
            });
            return stdout || stderr || `Built image: ${tag}`;
        } catch (err: any) {
            return `Docker build error: ${err.message}`;
        }
    }

    /**
     * Run Docker container
     */
    async runDocker(tag: string = 'app:latest', port: number = 3000): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `docker run -d -p ${port}:${port} --name app-container ${tag}`,
                { cwd: this.workspaceRoot }
            );
            return `Container started: ${stdout.trim()}\nApp running on http://localhost:${port}`;
        } catch (err: any) {
            return `Docker run error: ${err.message}`;
        }
    }

    /**
     * Docker compose up
     */
    async composeUp(detached: boolean = true): Promise<string> {
        const cmd = detached ? 'docker-compose up -d' : 'docker-compose up';
        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: this.workspaceRoot,
                timeout: 300000
            });
            return stdout || stderr || 'Services started';
        } catch (err: any) {
            return `Compose error: ${err.message}`;
        }
    }

    /**
     * Docker compose down
     */
    async composeDown(): Promise<string> {
        try {
            const { stdout, stderr } = await execAsync('docker-compose down', {
                cwd: this.workspaceRoot
            });
            return stdout || stderr || 'Services stopped';
        } catch (err: any) {
            return `Compose error: ${err.message}`;
        }
    }
}

// ============================================================================
// Environment Management
// ============================================================================

export class EnvManager {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * List environment variables from .env.example (safe to read)
     */
    async listEnvTemplate(): Promise<Record<string, string>> {
        const examplePath = path.join(this.workspaceRoot, '.env.example');
        const envVars: Record<string, string> = {};

        try {
            const content = await fsPromises.readFile(examplePath, 'utf-8');
            const lines = content.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const [key, ...valueParts] = trimmed.split('=');
                    const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                    envVars[key] = value;
                }
            }
        } catch {
            // No .env.example
        }

        return envVars;
    }

    /**
     * Check which env vars are missing
     */
    async checkMissingEnv(): Promise<string[]> {
        const template = await this.listEnvTemplate();
        const envPath = path.join(this.workspaceRoot, '.env');
        const missing: string[] = [];

        try {
            const content = await fsPromises.readFile(envPath, 'utf-8');
            const definedVars = new Set(
                content.split('\n')
                    .filter(l => l.trim() && !l.startsWith('#'))
                    .map(l => l.split('=')[0])
            );

            for (const key of Object.keys(template)) {
                if (!definedVars.has(key)) {
                    missing.push(key);
                }
            }
        } catch {
            // No .env file, all are missing
            missing.push(...Object.keys(template));
        }

        return missing;
    }

    /**
     * Create .env from .env.example
     */
    async createEnvFromExample(): Promise<string> {
        const examplePath = path.join(this.workspaceRoot, '.env.example');
        const envPath = path.join(this.workspaceRoot, '.env');

        try {
            // Check if .env already exists
            try {
                await fsPromises.access(envPath);
                return '.env already exists. Delete it first if you want to recreate.';
            } catch {
                // Doesn't exist, good to proceed
            }

            await fsPromises.copyFile(examplePath, envPath);
            return 'Created .env from .env.example. Please fill in the actual values.';
        } catch {
            return 'No .env.example found. Create one first with your required variables.';
        }
    }

    /**
     * Set a single env variable (in .env file)
     * NOTE: This is controlled - only allows setting specific allowed vars
     */
    async setEnvVar(key: string, value: string): Promise<string> {
        // Only allow certain "safe" env vars to be set programmatically
        const allowedVars = [
            'PORT', 'HOST', 'NODE_ENV', 'DEBUG', 
            'DATABASE_URL', 'REDIS_URL',
            'NEXT_PUBLIC_', 'VITE_', 'REACT_APP_'
        ];

        const isAllowed = allowedVars.some(allowed => 
            key === allowed || key.startsWith(allowed)
        );

        if (!isAllowed) {
            return `Cannot set ${key} programmatically. Only these are allowed: ${allowedVars.join(', ')}`;
        }

        const envPath = path.join(this.workspaceRoot, '.env');
        let content = '';

        try {
            content = await fsPromises.readFile(envPath, 'utf-8');
        } catch {
            // File doesn't exist, will create
        }

        const lines = content.split('\n');
        let found = false;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith(`${key}=`)) {
                lines[i] = `${key}=${value}`;
                found = true;
                break;
            }
        }

        if (!found) {
            lines.push(`${key}=${value}`);
        }

        await fsPromises.writeFile(envPath, lines.join('\n'));
        return `Set ${key} in .env`;
    }

    /**
     * Generate .env.example from current .env (strips values)
     */
    async generateEnvExample(): Promise<string> {
        const envPath = path.join(this.workspaceRoot, '.env');
        const examplePath = path.join(this.workspaceRoot, '.env.example');

        try {
            const content = await fsPromises.readFile(envPath, 'utf-8');
            const lines = content.split('\n');
            const exampleLines: string[] = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    exampleLines.push(line);
                } else {
                    const [key] = trimmed.split('=');
                    // Add placeholder value
                    if (key.includes('SECRET') || key.includes('KEY') || key.includes('PASSWORD')) {
                        exampleLines.push(`${key}=your-${key.toLowerCase().replace(/_/g, '-')}-here`);
                    } else if (key.includes('URL')) {
                        exampleLines.push(`${key}=your-url-here`);
                    } else {
                        exampleLines.push(`${key}=`);
                    }
                }
            }

            await fsPromises.writeFile(examplePath, exampleLines.join('\n'));
            return 'Generated .env.example from .env (values stripped)';
        } catch {
            return 'No .env file found';
        }
    }
}
