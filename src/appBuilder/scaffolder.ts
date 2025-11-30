/**
 * Scaffolder - Creates new projects from templates
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    AppSpec,
    Architecture,
    PageRoute,
    Entity
} from './types';
import { ArchitectureGenerator } from './architectureGenerator';

export interface TemplateVars {
    APP_NAME: string;
    DISPLAY_NAME: string;
    DESCRIPTION: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
}

export class Scaffolder {
    private templateDir: string;
    private outputChannel: vscode.OutputChannel;

    constructor(extensionPath: string) {
        this.templateDir = path.join(extensionPath, 'src', 'appBuilder', 'templates');
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Scaffolder');
    }

    /**
     * Main scaffold method - creates full project structure
     */
    async scaffold(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
    ): Promise<void> {
        this.log(`Scaffolding project: ${spec.name} at ${targetDir}`);

        // 1. Create target directory
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 2. Copy base template
        this.log('Copying base template...');
        await this.copyTemplate('base', targetDir);

        // 3. Copy app-type specific template (if exists)
        const appTypeTemplateDir = path.join(this.templateDir, spec.type);
        if (fs.existsSync(appTypeTemplateDir)) {
            this.log(`Copying ${spec.type} template...`);
            await this.copyTemplate(spec.type, targetDir);
        }

        // 4. Process template variables
        this.log('Processing template variables...');
        const vars: TemplateVars = {
            APP_NAME: spec.name,
            DISPLAY_NAME: spec.displayName,
            DESCRIPTION: spec.description,
            SUPABASE_URL: spec.supabase?.projectUrl,
            SUPABASE_ANON_KEY: spec.supabase?.anonKey
        };
        await this.processTemplateVars(targetDir, vars);

        // 5. Generate pages from spec
        this.log('Generating page components...');
        await this.generatePages(targetDir, spec.pages);

        // 6. Generate database types from entities
        this.log('Generating database types...');
        await this.generateDatabaseTypes(targetDir, spec.entities);

        // 7. Generate router with routes
        this.log('Generating router...');
        await this.generateRouter(targetDir, spec.pages, spec.features.includes('auth'));

        // 8. Generate Supabase migration SQL
        this.log('Generating database migration...');
        const archGenerator = new ArchitectureGenerator();
        const migrationSQL = archGenerator.generateMigrationSQL(architecture.database);
        await this.writeMigration(targetDir, migrationSQL);

        // 9. Create .env file from example
        this.log('Creating environment file...');
        await this.createEnvFile(targetDir, vars);

        this.log('Scaffolding complete!');
    }

    /**
     * Copy template directory to target
     */
    private async copyTemplate(templateName: string, targetDir: string): Promise<void> {
        const sourceDir = path.join(this.templateDir, templateName);
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Template not found: ${templateName}`);
        }

        await this.copyDir(sourceDir, targetDir);
    }

    /**
     * Recursively copy directory
     */
    private async copyDir(source: string, target: string): Promise<void> {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }

        const entries = fs.readdirSync(source, { withFileTypes: true });

        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const targetPath = path.join(target, entry.name);

            if (entry.isDirectory()) {
                await this.copyDir(sourcePath, targetPath);
            } else {
                // Handle .tmpl files - remove extension
                let finalTargetPath = targetPath;
                if (entry.name.endsWith('.tmpl')) {
                    finalTargetPath = targetPath.replace('.tmpl', '');
                }
                fs.copyFileSync(sourcePath, finalTargetPath);
            }
        }
    }

    /**
     * Process template variables in all files
     */
    private async processTemplateVars(dir: string, vars: TemplateVars): Promise<void> {
        const processFile = (filePath: string) => {
            // Only process text files
            const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.env'];
            const ext = path.extname(filePath);
            if (!textExtensions.includes(ext) && !filePath.endsWith('.example')) {
                return;
            }

            let content = fs.readFileSync(filePath, 'utf-8');
            let modified = false;

            // Replace {{VAR}} patterns
            for (const [key, value] of Object.entries(vars)) {
                if (value !== undefined) {
                    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                    if (pattern.test(content)) {
                        content = content.replace(pattern, value);
                        modified = true;
                    }
                }
            }

            if (modified) {
                fs.writeFileSync(filePath, content);
            }
        };

        const processDir = (dirPath: string) => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && entry.name !== 'node_modules') {
                    processDir(fullPath);
                } else if (entry.isFile()) {
                    processFile(fullPath);
                }
            }
        };

        processDir(dir);
    }

    /**
     * Generate page components from routes
     */
    private async generatePages(dir: string, pages: PageRoute[]): Promise<void> {
        const pagesDir = path.join(dir, 'src', 'pages');
        if (!fs.existsSync(pagesDir)) {
            fs.mkdirSync(pagesDir, { recursive: true });
        }

        for (const page of pages) {
            // Skip home page - already in template
            if (page.path === '/') continue;

            const componentName = page.component;
            const filePath = path.join(pagesDir, `${componentName}.tsx`);

            // Don't overwrite existing
            if (fs.existsSync(filePath)) continue;

            const content = this.generatePageComponent(page);
            fs.writeFileSync(filePath, content);
        }
    }

    /**
     * Generate a single page component
     */
    private generatePageComponent(page: PageRoute): string {
        const isAuthPage = ['LoginPage', 'SignupPage', 'ForgotPasswordPage'].includes(page.component);
        const isDashboardPage = page.layout === 'dashboard';

        if (isAuthPage) {
            return this.generateAuthPageTemplate(page);
        }

        if (isDashboardPage) {
            return this.generateDashboardPageTemplate(page);
        }

        return `import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function ${page.component}() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-4">${page.title || page.name}</h1>
      <p className="text-muted-foreground">
        This is the ${page.name} page.
      </p>
      <div className="mt-4">
        <Link to="/">
          <Button variant="outline">Back to Home</Button>
        </Link>
      </div>
    </div>
  )
}
`;
    }

    /**
     * Generate auth page template
     */
    private generateAuthPageTemplate(page: PageRoute): string {
        const isLogin = page.component === 'LoginPage';
        const isSignup = page.component === 'SignupPage';

        return `import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'

export default function ${page.component}() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  ${isSignup ? "const [confirmPassword, setConfirmPassword] = useState('')" : ''}
  const [loading, setLoading] = useState(false)
  const { ${isLogin ? 'signIn' : 'signUp'} } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    ${isSignup ? `
    if (password !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' })
      return
    }` : ''}

    setLoading(true)
    try {
      await ${isLogin ? 'signIn' : 'signUp'}(email, password)
      ${isLogin ? "navigate('/dashboard')" : "toast({ title: 'Success', description: 'Check your email to confirm your account' })"}
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>${isLogin ? 'Sign In' : 'Create Account'}</CardTitle>
          <CardDescription>
            ${isLogin ? 'Enter your credentials to access your account' : 'Enter your details to create an account'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            ${isSignup ? `<div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>` : ''}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Loading...' : '${isLogin ? 'Sign In' : 'Sign Up'}'}
            </Button>
            <p className="text-sm text-muted-foreground">
              ${isLogin ? "Don't have an account? " : 'Already have an account? '}
              <Link to="${isLogin ? '/signup' : '/login'}" className="text-primary hover:underline">
                ${isLogin ? 'Sign up' : 'Sign in'}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
`;
    }

    /**
     * Generate dashboard page template
     */
    private generateDashboardPageTemplate(page: PageRoute): string {
        return `import { useAuth } from '@/hooks/useAuth'

export default function ${page.component}() {
  const { user } = useAuth()

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">${page.title || page.name}</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Welcome</h3>
          <p className="text-2xl font-bold">{user?.email}</p>
        </div>
        {/* Add more dashboard cards here */}
      </div>
    </div>
  )
}
`;
    }

    /**
     * Generate database types from entities
     */
    private async generateDatabaseTypes(dir: string, entities: Entity[]): Promise<void> {
        const typesDir = path.join(dir, 'src', 'types');
        if (!fs.existsSync(typesDir)) {
            fs.mkdirSync(typesDir, { recursive: true });
        }

        const filePath = path.join(typesDir, 'database.ts');

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
     * Generate React Router configuration
     */
    private async generateRouter(dir: string, pages: PageRoute[], hasAuth: boolean): Promise<void> {
        const appPath = path.join(dir, 'src', 'App.tsx');

        // Build imports
        const imports: string[] = [
            "import { Routes, Route } from 'react-router-dom'",
            "import { Toaster } from '@/components/ui/toaster'"
        ];

        if (hasAuth) {
            imports.push("import { AuthProvider } from '@/hooks/useAuth'");
        }

        // Import all pages
        for (const page of pages) {
            imports.push(`import ${page.component} from '@/pages/${page.component}'`);
        }

        // Build routes
        const routes: string[] = [];
        for (const page of pages) {
            routes.push(`        <Route path="${page.path}" element={<${page.component} />} />`);
        }

        let content = `${imports.join('\n')}

function App() {
  return (
    ${hasAuth ? '<AuthProvider>' : '<>'}
      <Routes>
${routes.join('\n')}
      </Routes>
      <Toaster />
    ${hasAuth ? '</AuthProvider>' : '</>'}
  )
}

export default App
`;

        fs.writeFileSync(appPath, content);
    }

    /**
     * Write migration SQL file
     */
    private async writeMigration(dir: string, sql: string): Promise<void> {
        const migrationsDir = path.join(dir, 'supabase', 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const filePath = path.join(migrationsDir, `${timestamp}_init.sql`);

        fs.writeFileSync(filePath, sql);
    }

    /**
     * Create .env file from template vars
     */
    private async createEnvFile(dir: string, vars: TemplateVars): Promise<void> {
        const envPath = path.join(dir, '.env');

        let content = `# Supabase Configuration
VITE_SUPABASE_URL=${vars.SUPABASE_URL || 'https://your-project.supabase.co'}
VITE_SUPABASE_ANON_KEY=${vars.SUPABASE_ANON_KEY || 'your-anon-key'}
`;

        fs.writeFileSync(envPath, content);
    }

    /**
     * Log message to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Run shell command in directory
     */
    async runCommand(command: string, cwd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');

            this.log(`Running: ${command}`);

            exec(command, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
                if (stdout) this.log(stdout);
                if (stderr) this.log(stderr);

                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Install npm dependencies
     */
    async installDependencies(dir: string): Promise<void> {
        await this.runCommand('npm install', dir);
    }
}
