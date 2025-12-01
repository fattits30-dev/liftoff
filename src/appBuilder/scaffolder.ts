/**
 * Scaffolder - Creates new projects from templates
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    AppSpec,
    Architecture,
    Entity
} from './types';
import { ArchitectureGenerator } from './architectureGenerator';
import { ScaffolderAgent } from './scaffolderAgent';
import { MainOrchestrator } from '../mainOrchestrator';
import { validatePath } from '../utils/pathValidator';
import {
    Tier1BootstrapError,
    Tier2OverlayError,
    ValidationError,
    TimeoutError
} from './scaffolderErrors';

export class Scaffolder {
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string;
    private mainOrchestrator?: MainOrchestrator;
    private extensionPath: string;

    constructor(extensionPath: string, mainOrchestrator?: MainOrchestrator) {
        this.extensionPath = extensionPath;
        this.mainOrchestrator = mainOrchestrator;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Scaffolder');
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    }

    /**
     * Main scaffold method - creates full project structure using three-tier hybrid approach
     */
    async scaffold(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
    ): Promise<void> {
        this.log(`Scaffolding project: ${spec.name} at ${targetDir}`);

        try {
            // 1. Validate paths (but DON'T create target dir - CLI will do that)
            validatePath(targetDir, this.workspaceRoot);

            // Check if target directory is suitable for building
            if (fs.existsSync(targetDir)) {
                // Directory exists (e.g., current workspace) - check if it's empty or only has acceptable files
                const entries = fs.readdirSync(targetDir);
                const allowedFiles = [
                    '.git', '.github', '.gitignore', '.vscode',
                    'README.md', 'LICENSE', '.liftoff',
                    'tech_stack_recommendation.json'  // Created during research phase
                ];
                const blockingEntries = entries.filter(entry => !allowedFiles.includes(entry));

                if (blockingEntries.length > 0) {
                    throw new ValidationError(
                        `Target directory is not empty. Found: ${blockingEntries.slice(0, 5).join(', ')}${blockingEntries.length > 5 ? '...' : ''}`,
                        'path',
                        'empty directory or only .git/.vscode files',
                        'directory with project files'
                    );
                }
                this.log(`Target directory exists but is suitable for scaffolding (only contains: ${entries.join(', ')})`);
            } else {
                // Directory doesn't exist - ensure parent exists so we can create it
                const parentDir = path.dirname(targetDir);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }
            }

            // THREE-TIER HYBRID APPROACH:

            // TIER 1: Official CLI Bootstrap (0 tokens, instant, 100% reliable)
            this.log('Bootstrapping with official CLIs...', 1);
            try {
                await this.bootstrapWithCLI(targetDir, spec);
                await this.validateBootstrap(targetDir, spec);
            } catch (error) {
                if (error instanceof Tier1BootstrapError || error instanceof ValidationError) {
                    throw error;
                }
                throw new Tier1BootstrapError(
                    'Bootstrap failed',
                    'unknown',
                    undefined,
                    error instanceof Error ? error.message : String(error)
                );
            }

            // TIER 2: Template Overlays (0 tokens, instant)
            this.log('Applying template overlays...', 2);
            try {
                await this.applyTemplateOverlays(targetDir, spec);
            } catch (error) {
                if (error instanceof Tier2OverlayError) {
                    throw error;
                }
                throw new Tier2OverlayError(
                    'Template overlay failed',
                    undefined,
                    'create'
                );
            }

            // TIER 3: AI Custom Code (200-400 tokens, 5-15s) - only if orchestrator available
            if (this.mainOrchestrator) {
                this.log('Generating custom business logic with AI...', 3);
                const scaffolderAgent = new ScaffolderAgent(
                    this.mainOrchestrator,
                    targetDir,
                    this.extensionPath
                );
                await scaffolderAgent.generateCustomFeatures(spec, architecture);
            }

            // Post-processing: Database types and migrations
            this.log('Generating database types...');
            await this.generateDatabaseTypes(targetDir, spec.entities);

            this.log('Generating database migration...');
            const archGenerator = new ArchitectureGenerator();
            const migrationSQL = archGenerator.generateMigrationSQL(architecture.database);
            await this.writeMigration(targetDir, migrationSQL);

            this.log('Scaffolding complete!');
        } catch (error) {
            this.log(`ERROR: Scaffolding failed - ${error instanceof Error ? error.message : String(error)}`);

            // Attempt rollback on failure
            await this.rollbackScaffold(targetDir);

            throw error;
        }
    }

    /**
     * TIER 1: Bootstrap project with official CLI tools
     */
    private async bootstrapWithCLI(targetDir: string, spec: AppSpec): Promise<void> {
        const { frontend, bundler, styling, components } = spec.stack;

        // If target directory exists (building in current workspace), use "." instead of project name
        const dirExists = fs.existsSync(targetDir);
        const projectArg = dirExists ? '.' : spec.name;
        const workingDir = dirExists ? targetDir : path.dirname(targetDir);

        // CRITICAL: CLI tools refuse to scaffold into non-empty directories
        // Temporarily move existing files aside so CLI sees "empty" directory
        const tempBackupDir = path.join(path.dirname(targetDir), '.liftoff-temp-backup');
        const movedFiles: string[] = [];

        if (dirExists) {
            const entries = fs.readdirSync(targetDir);
            if (entries.length > 0) {
                this.log(`Temporarily moving ${entries.length} files to allow CLI to run...`, 1);
                fs.mkdirSync(tempBackupDir, { recursive: true });

                for (const entry of entries) {
                    const srcPath = path.join(targetDir, entry);
                    const destPath = path.join(tempBackupDir, entry);
                    fs.renameSync(srcPath, destPath);
                    movedFiles.push(entry);
                }
            }
        }

        try {
            // Choose CLI based on stack
            if (frontend === 'react' && bundler === 'vite') {
            this.log(`Bootstrapping with Vite + React + TypeScript in ${dirExists ? 'current directory' : 'new directory'}...`, 1);
            await this.runCommand(
                `npm create vite@latest ${projectArg} -- --template react-ts`,
                workingDir
            );
        } else if (frontend === 'react' && bundler === 'turbopack') {
            this.log('Bootstrapping with Next.js + Turbopack...', 1);
            await this.runCommand(
                `npx create-next-app@latest ${projectArg} --typescript --tailwind --app --yes`,
                workingDir
            );
            // Next.js auto-installs, skip npm install step
            this.log('✓ CLI Bootstrap complete', 1);
            return;
        } else if (frontend === 'vue') {
            this.log('Bootstrapping with Vue + TypeScript...', 1);
            await this.runCommand(
                `npm create vue@latest ${projectArg} -- --typescript --router --yes`,
                workingDir
            );
        } else if (frontend === 'svelte') {
            this.log('Bootstrapping with SvelteKit...', 1);
            await this.runCommand(
                `npm create svelte@latest ${projectArg} -- --template skeleton --types ts`,
                workingDir
            );
        } else {
            // Default fallback to Vite React
            this.log('Defaulting to Vite + React + TypeScript...', 1);
            await this.runCommand(
                `npm create vite@latest ${projectArg} -- --template react-ts`,
                workingDir
            );
        }

        // Install base dependencies first
        this.log('Installing base dependencies...', 1);
        await this.runCommand('npm install', targetDir);

        // Initialize Tailwind if needed (and not Next.js which includes it)
        if (styling === 'tailwind' && bundler !== 'turbopack') {
            this.log('Installing Tailwind CSS...', 1);
            await this.runCommand('npm install -D tailwindcss postcss autoprefixer', targetDir);
            await this.runCommand('npx tailwindcss init -p', targetDir);
        }

        // Initialize shadcn/ui components
        if (components === 'shadcn' && styling === 'tailwind') {
            this.log('Installing shadcn/ui components...', 1);

            // Initialize shadcn/ui with defaults
            await this.runCommand('npx shadcn-ui@latest init --yes --defaults', targetDir);

            // Add essential components
            const essentialComponents = ['button', 'input', 'card', 'form', 'table', 'toast', 'label'];
            this.log(`Adding essential components: ${essentialComponents.join(', ')}...`);
            for (const comp of essentialComponents) {
                try {
                    await this.runCommand(`npx shadcn-ui@latest add ${comp} --yes`, targetDir);
                } catch (error) {
                    this.log(`Warning: Could not add ${comp} component: ${error}`);
                }
            }
        }

            this.log('✓ CLI Bootstrap complete', 1);
        } finally {
            // Restore moved files back to target directory
            if (movedFiles.length > 0 && fs.existsSync(tempBackupDir)) {
                this.log(`Restoring ${movedFiles.length} files back to project directory...`, 1);
                for (const file of movedFiles) {
                    const srcPath = path.join(tempBackupDir, file);
                    const destPath = path.join(targetDir, file);
                    if (fs.existsSync(srcPath)) {
                        fs.renameSync(srcPath, destPath);
                    }
                }
                // Clean up temp directory
                fs.rmdirSync(tempBackupDir, { recursive: true });
            }
        }
    }

    /**
     * TIER 2: Apply template overlays (pre-built files with variable replacement)
     */
    private async applyTemplateOverlays(targetDir: string, spec: AppSpec): Promise<void> {
        this.log('Copying Supabase client template...', 2);

        // Ensure lib directory exists
        const libDir = path.join(targetDir, 'src', 'lib');
        if (!fs.existsSync(libDir)) {
            fs.mkdirSync(libDir, { recursive: true });
        }

        // Copy Supabase client (pre-built, zero-token template)
        const supabaseTemplate = `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;
        const supabasePath = path.join(libDir, 'supabase.ts');
        validatePath(supabasePath, this.workspaceRoot);
        try {
            fs.writeFileSync(supabasePath, supabaseTemplate);
        } catch (_error) {
            throw new Tier2OverlayError(
                'Failed to write Supabase client template',
                supabasePath,
                'write'
            );
        }

        // Copy auth hook if auth feature enabled
        if (spec.features.includes('auth')) {
            this.log('Copying auth hook template...', 2);
            const hooksDir = path.join(targetDir, 'src', 'hooks');
            if (!fs.existsSync(hooksDir)) {
                fs.mkdirSync(hooksDir, { recursive: true });
            }

            const authHookTemplate = `import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
`;
            const authHookPath = path.join(hooksDir, 'useAuth.tsx');
            validatePath(authHookPath, this.workspaceRoot);
            fs.writeFileSync(authHookPath, authHookTemplate);
        }

        // Create .env template
        this.log('Creating .env template...', 2);
        const envTemplate = `# App Configuration
VITE_APP_NAME=${spec.name}

# Supabase
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
`;
        const envPath = path.join(targetDir, '.env.example');
        validatePath(envPath, this.workspaceRoot);
        fs.writeFileSync(envPath, envTemplate);

        // Install Supabase dependency
        this.log('Installing @supabase/supabase-js...', 2);
        await this.runCommand('npm install @supabase/supabase-js', targetDir);

        this.log('✓ Template overlays applied', 2);
    }

    /**
     * Validate that CLI bootstrap succeeded
     */
    private async validateBootstrap(targetDir: string, spec: AppSpec): Promise<void> {
        this.log('Validating bootstrap...', 1);

        const requiredFiles = [
            'package.json',
            'tsconfig.json',
            'src/main.tsx',
            'index.html'
        ];

        // Add bundler-specific files
        if (spec.stack.bundler === 'vite' || !spec.stack.bundler) {
            requiredFiles.push('vite.config.ts');
        }

        // Check required files exist
        for (const file of requiredFiles) {
            const filePath = path.join(targetDir, file);
            if (!fs.existsSync(filePath)) {
                throw new ValidationError(
                    `Bootstrap failed: ${file} not found. CLI may have failed.`,
                    'file',
                    file,
                    'missing'
                );
            }
        }

        // Verify package.json has required dependencies
        const packageJsonPath = path.join(targetDir, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

        const requiredDeps = ['react', 'react-dom'];
        for (const dep of requiredDeps) {
            if (!packageJson.dependencies?.[dep] && !packageJson.devDependencies?.[dep]) {
                throw new ValidationError(
                    `Bootstrap incomplete: ${dep} not installed`,
                    'dependency',
                    dep,
                    'missing'
                );
            }
        }

        this.log('✓ Bootstrap validation passed', 1);
    }









    /**
     * Generate database types from entities
     */
    private async generateDatabaseTypes(dir: string, entities: Entity[]): Promise<void> {
        const typesDir = path.join(dir, 'src', 'types');
        validatePath(typesDir, this.workspaceRoot);
        if (!fs.existsSync(typesDir)) {
            fs.mkdirSync(typesDir, { recursive: true });
        }

        const filePath = path.join(typesDir, 'database.ts');
        validatePath(filePath, this.workspaceRoot);

        let content = `// Auto-generated database types
// Regenerate with: supabase gen types typescript

export interface Database {
  public: {
    Tables: {
`;

        for (const entity of entities) {
            const rowType = this.generateRowType(entity);
            const insertType = this.generateInsertType(entity);
            const updateType = this.generateUpdateType(entity);

            content += `      ${entity.tableName}: {
        Row: ${rowType}
        Insert: ${insertType}
        Update: ${updateType}
      }
`;
        }

        content += `    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
`;

        fs.writeFileSync(filePath, content);
    }

    /**
     * Generate Row type for entity
     */
    private generateRowType(entity: Entity): string {
        const fields: string[] = [];

        for (const field of entity.fields) {
            const tsType = this.fieldTypeToTS(field.type);
            const optional = !field.required ? ' | null' : '';
            fields.push(`${field.name}: ${tsType}${optional}`);
        }

        if (entity.timestamps) {
            fields.push('created_at: string');
            fields.push('updated_at: string');
        }

        if (entity.softDelete) {
            fields.push('deleted_at: string | null');
        }

        return `{\n          ${fields.join('\n          ')}\n        }`;
    }

    /**
     * Generate Insert type for entity
     */
    private generateInsertType(entity: Entity): string {
        const fields: string[] = [];

        for (const field of entity.fields) {
            const tsType = this.fieldTypeToTS(field.type);
            const optional = !field.required || field.default !== undefined || field.name === 'id' ? '?' : '';
            fields.push(`${field.name}${optional}: ${tsType}${!field.required ? ' | null' : ''}`);
        }

        if (entity.timestamps) {
            fields.push('created_at?: string');
            fields.push('updated_at?: string');
        }

        return `{\n          ${fields.join('\n          ')}\n        }`;
    }

    /**
     * Generate Update type for entity
     */
    private generateUpdateType(entity: Entity): string {
        const fields: string[] = [];

        for (const field of entity.fields) {
            const tsType = this.fieldTypeToTS(field.type);
            fields.push(`${field.name}?: ${tsType}${!field.required ? ' | null' : ''}`);
        }

        if (entity.timestamps) {
            fields.push('updated_at?: string');
        }

        return `{\n          ${fields.join('\n          ')}\n        }`;
    }

    /**
     * Convert field type to TypeScript type
     */
    private fieldTypeToTS(fieldType: string): string {
        const typeMap: Record<string, string> = {
            text: 'string',
            number: 'number',
            boolean: 'boolean',
            date: 'string',
            datetime: 'string',
            email: 'string',
            url: 'string',
            uuid: 'string',
            json: 'Record<string, unknown>',
            enum: 'string',
            relation: 'string'
        };
        return typeMap[fieldType] || 'unknown';
    }


    /**
     * Write migration SQL file
     */
    private async writeMigration(dir: string, sql: string): Promise<void> {
        const migrationsDir = path.join(dir, 'supabase', 'migrations');
        validatePath(migrationsDir, this.workspaceRoot);
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const filePath = path.join(migrationsDir, `${timestamp}_init.sql`);
        validatePath(filePath, this.workspaceRoot);

        fs.writeFileSync(filePath, sql);
    }



    /**
     * Rollback/cleanup failed scaffold attempt
     */
    private async rollbackScaffold(targetDir: string): Promise<void> {
        try {
            this.log('Rolling back failed scaffold...');

            if (fs.existsSync(targetDir)) {
                // Remove the partially created project directory
                fs.rmSync(targetDir, { recursive: true, force: true });
                this.log('Rollback complete - cleaned up target directory');
            }
        } catch (rollbackError) {
            this.log(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
            // Don't throw rollback errors - original error is more important
        }
    }

    /**
     * Log message to output channel with formatted timestamp and optional tier label
     */
    private log(message: string, tier?: 1 | 2 | 3): void {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        const timestamp = `${hours}:${minutes}:${seconds}.${ms}`;

        const tierLabel = tier ? `[TIER ${tier}] ` : '';
        this.outputChannel.appendLine(`[${timestamp}] ${tierLabel}${message}`);
    }

    /**
     * Run shell command in directory with timeout
     */
    async runCommand(
        command: string,
        cwd: string,
        timeoutMs: number = 300000 // 5 minutes default
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');

            this.log(`Running: ${command}`);

            const child = exec(command, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
                if (stdout) this.log(stdout);
                if (stderr) this.log(stderr);

                if (error) {
                    const bootstrapError = new Tier1BootstrapError(
                        `Command failed: ${command}`,
                        command,
                        (error as any).code,
                        stderr
                    );
                    reject(bootstrapError);
                } else {
                    resolve();
                }
            });

            // Set timeout
            const timeout = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new TimeoutError(
                    `Command timed out after ${timeoutMs}ms`,
                    command,
                    timeoutMs
                ));
            }, timeoutMs);

            // Clear timeout on completion
            child.on('exit', () => clearTimeout(timeout));
        });
    }

    /**
     * Install npm dependencies
     */
    async installDependencies(dir: string): Promise<void> {
        await this.runCommand('npm install', dir);
    }
}
