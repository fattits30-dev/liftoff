/**
 * Spec Generator - Gathers requirements and creates AppSpec
 */

import * as vscode from 'vscode';
import {
    AppSpec,
    AppType,
    FeatureType,
    Entity,
    EntityField,
    PageRoute,
} from './types';
// SPEC_QUESTIONS not used in this file

export class SpecGenerator {
    
    /**
     * Run interactive spec gathering via VS Code quick picks
     */
    async gatherSpec(): Promise<AppSpec | null> {
        try {
            // App Type
            const appType = await vscode.window.showQuickPick(
                ['saas', 'dashboard', 'landing', 'crud', 'ecommerce', 'blog', 'portfolio'],
                { placeHolder: 'What type of app are you building?', title: 'App Type' }
            ) as AppType;
            if (!appType) return null;

            // App Name
            const appName = await vscode.window.showInputBox({
                prompt: 'App name (lowercase, no spaces)',
                placeHolder: 'my-app',
                validateInput: (value) => {
                    if (!/^[a-z][a-z0-9-]*$/.test(value)) {
                        return 'Must be lowercase, start with letter, only letters/numbers/hyphens';
                    }
                    return null;
                }
            });
            if (!appName) return null;

            // Display Name
            const displayName = await vscode.window.showInputBox({
                prompt: 'Display name (shown in UI)',
                placeHolder: 'My Awesome App',
                value: this.toTitleCase(appName)
            });
            if (!displayName) return null;

            // Description
            const description = await vscode.window.showInputBox({
                prompt: 'Brief description of what this app does',
                placeHolder: 'A project management tool for small teams'
            });
            if (!description) return null;

            // Features
            const featureOptions = [
                { label: '🔐 auth', description: 'User authentication (login, signup)', picked: true },
                { label: '🗄️ database', description: 'Supabase tables + queries', picked: true },
                { label: '📁 file-upload', description: 'File/image storage' },
                { label: '💳 payments', description: 'Stripe integration' },
                { label: '📧 email', description: 'Transactional emails' },
                { label: '⚡ realtime', description: 'Live updates via Supabase' },
                { label: '🔍 search', description: 'Full-text search' },
                { label: '👑 admin', description: 'Admin dashboard' },
                { label: '🔗 social-auth', description: 'OAuth (Google, GitHub)' },
                { label: '🛡️ rbac', description: 'Role-based access control' },
            ];

            const selectedFeatures = await vscode.window.showQuickPick(featureOptions, {
                canPickMany: true,
                placeHolder: 'Select features (Space to toggle, Enter to confirm)',
                title: 'Features'
            });
            if (!selectedFeatures) return null;

            const features = selectedFeatures.map(f => 
                f.label.split(' ')[1] as FeatureType
            );

            // Pages
            const defaultPages = this.getDefaultPages(appType, features);
            const pagesInput = await vscode.window.showInputBox({
                prompt: 'Pages (comma-separated paths)',
                value: defaultPages.join(', '),
                placeHolder: '/, /login, /dashboard, /settings'
            });
            if (!pagesInput) return null;

            const pages = this.parsePages(pagesInput, features.includes('auth'));

            // Entities (Data Models)
            const entities = await this.gatherEntities(appType);

            // Hosting
            const hosting = await vscode.window.showQuickPick(
                ['vercel', 'netlify'],
                { placeHolder: 'Where will you deploy?', title: 'Hosting' }
            ) as 'vercel' | 'netlify';
            if (!hosting) return null;

            // Build final spec
            const spec: AppSpec = {
                name: appName,
                displayName,
                description,
                version: '0.1.0',
                type: appType,
                features,
                entities,
                pages,
                stack: {
                    frontend: 'react',
                    styling: 'tailwind',
                    components: 'shadcn',
                    backend: 'supabase',
                    hosting
                }
            };

            return spec;

        } catch (error) {
            vscode.window.showErrorMessage(`Spec generation failed: ${error}`);
            return null;
        }
    }

    /**
     * Create spec from natural language description (LLM-powered)
     */
    async generateSpecFromDescription(description: string): Promise<Partial<AppSpec>> {
        // This will be called by the orchestrator with LLM
        // Returns partial spec that can be refined
        const inferredType = this.inferAppType(description);
        const inferredFeatures = this.inferFeatures(description);
        
        return {
            description,
            type: inferredType,
            features: inferredFeatures,
            stack: {
                frontend: 'react',
                styling: 'tailwind',
                components: 'shadcn',
                backend: 'supabase',
                hosting: 'vercel'
            }
        };
    }

    /**
     * Gather entity definitions
     */
    private async gatherEntities(appType: AppType): Promise<Entity[]> {
        const entities: Entity[] = [];
        
        // Default entities based on app type
        const defaults = this.getDefaultEntities(appType);
        
        const useDefaults = await vscode.window.showQuickPick(
            ['Yes, use defaults', 'No, I\'ll define my own'],
            { placeHolder: `Use default data models for ${appType}?` }
        );

        if (useDefaults === 'Yes, use defaults') {
            return defaults;
        }

        // Custom entity gathering
        let addMore = true;
        while (addMore) {
            const entityName = await vscode.window.showInputBox({
                prompt: 'Entity name (e.g., User, Project, Task)',
                placeHolder: 'Project'
            });
            
            if (!entityName) break;

            const entity = await this.gatherEntityFields(entityName);
            if (entity) {
                entities.push(entity);
            }

            const continueAdding = await vscode.window.showQuickPick(
                ['Add another entity', 'Done adding entities'],
                { placeHolder: 'Add more data models?' }
            );
            addMore = continueAdding === 'Add another entity';
        }

        return entities.length > 0 ? entities : defaults;
    }

    /**
     * Gather fields for a single entity
     */
    private async gatherEntityFields(entityName: string): Promise<Entity | null> {
        const fieldsInput = await vscode.window.showInputBox({
            prompt: `Fields for ${entityName} (comma-separated, e.g., "title:text, status:enum, owner_id:relation")`,
            placeHolder: 'title:text, description:text, status:enum, created_by:relation'
        });

        if (!fieldsInput) return null;

        const fields = this.parseFields(fieldsInput);

        return {
            name: entityName,
            tableName: this.toSnakeCase(entityName),
            fields,
            timestamps: true,
            rls: true,
            rlsPolicy: 'owner'
        };
    }

    /**
     * Parse field definitions from string
     */
    private parseFields(input: string): EntityField[] {
        return input.split(',').map(f => {
            const [name, type = 'text'] = f.trim().split(':');
            return {
                name: name.trim(),
                type: (type.trim() || 'text') as any,
                required: true
            };
        });
    }

    /**
     * Parse page paths into PageRoute objects
     */
    private parsePages(input: string, hasAuth: boolean): PageRoute[] {
        const authPages = ['/login', '/signup', '/forgot-password'];
        const dashboardPages = ['/dashboard', '/settings', '/profile'];

        return input.split(',').map(p => {
            const path = p.trim().startsWith('/') ? p.trim() : `/${p.trim()}`;
            const name = this.pathToName(path);
            
            let layout: PageRoute['layout'] = 'default';
            let protected_ = false;

            if (authPages.some(ap => path.includes(ap.replace('/', '')))) {
                layout = 'auth';
            } else if (dashboardPages.some(dp => path.includes(dp.replace('/', '')))) {
                layout = 'dashboard';
                protected_ = hasAuth;
            }

            return {
                path,
                name,
                component: `${name}Page`,
                layout,
                protected: protected_
            };
        });
    }

    /**
     * Get default pages based on app type
     */
    private getDefaultPages(appType: AppType, features: FeatureType[]): string[] {
        const base = ['/'];
        
        if (features.includes('auth')) {
            base.push('/login', '/signup');
        }

        switch (appType) {
            case 'saas':
            case 'dashboard':
                base.push('/dashboard', '/settings');
                break;
            case 'ecommerce':
                base.push('/products', '/cart', '/checkout');
                break;
            case 'blog':
                base.push('/posts', '/posts/[slug]');
                break;
            case 'crud':
                base.push('/dashboard', '/items', '/items/new');
                break;
        }

        return base;
    }

    /**
     * Get default entities based on app type
     */
    private getDefaultEntities(appType: AppType): Entity[] {
        const baseUser: Entity = {
            name: 'Profile',
            tableName: 'profiles',
            fields: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'email', type: 'email', required: true, unique: true },
                { name: 'full_name', type: 'text', required: false },
                { name: 'avatar_url', type: 'url', required: false }
            ],
            timestamps: true,
            rls: true,
            rlsPolicy: 'owner'
        };

        switch (appType) {
            case 'saas':
                return [
                    baseUser,
                    {
                        name: 'Project',
                        tableName: 'projects',
                        fields: [
                            { name: 'id', type: 'uuid', required: true, unique: true },
                            { name: 'name', type: 'text', required: true },
                            { name: 'description', type: 'text', required: false },
                            { name: 'owner_id', type: 'relation', required: true, relationTo: 'profiles', relationField: 'id' }
                        ],
                        timestamps: true,
                        rls: true,
                        rlsPolicy: 'owner'
                    }
                ];
            
            case 'crud':
                return [
                    baseUser,
                    {
                        name: 'Item',
                        tableName: 'items',
                        fields: [
                            { name: 'id', type: 'uuid', required: true, unique: true },
                            { name: 'title', type: 'text', required: true },
                            { name: 'content', type: 'text', required: false },
                            { name: 'status', type: 'enum', required: true, enumValues: ['draft', 'published', 'archived'] },
                            { name: 'owner_id', type: 'relation', required: true, relationTo: 'profiles', relationField: 'id' }
                        ],
                        timestamps: true,
                        rls: true,
                        rlsPolicy: 'owner'
                    }
                ];

            case 'ecommerce':
                return [
                    baseUser,
                    {
                        name: 'Product',
                        tableName: 'products',
                        fields: [
                            { name: 'id', type: 'uuid', required: true, unique: true },
                            { name: 'name', type: 'text', required: true },
                            { name: 'description', type: 'text', required: false },
                            { name: 'price', type: 'number', required: true },
                            { name: 'image_url', type: 'url', required: false },
                            { name: 'stock', type: 'number', required: true, default: 0 }
                        ],
                        timestamps: true,
                        rls: true,
                        rlsPolicy: 'public-read'
                    },
                    {
                        name: 'Order',
                        tableName: 'orders',
                        fields: [
                            { name: 'id', type: 'uuid', required: true, unique: true },
                            { name: 'user_id', type: 'relation', required: true, relationTo: 'profiles', relationField: 'id' },
                            { name: 'status', type: 'enum', required: true, enumValues: ['pending', 'paid', 'shipped', 'delivered'] },
                            { name: 'total', type: 'number', required: true }
                        ],
                        timestamps: true,
                        rls: true,
                        rlsPolicy: 'owner'
                    }
                ];

            case 'blog':
                return [
                    baseUser,
                    {
                        name: 'Post',
                        tableName: 'posts',
                        fields: [
                            { name: 'id', type: 'uuid', required: true, unique: true },
                            { name: 'title', type: 'text', required: true },
                            { name: 'slug', type: 'text', required: true, unique: true },
                            { name: 'content', type: 'text', required: true },
                            { name: 'published', type: 'boolean', required: true, default: false },
                            { name: 'author_id', type: 'relation', required: true, relationTo: 'profiles', relationField: 'id' }
                        ],
                        timestamps: true,
                        rls: true,
                        rlsPolicy: 'public-read'
                    }
                ];

            default:
                return [baseUser];
        }
    }

    /**
     * Infer app type from description
     */
    private inferAppType(description: string): AppType {
        const lower = description.toLowerCase();
        
        if (lower.includes('shop') || lower.includes('store') || lower.includes('product') || lower.includes('cart')) {
            return 'ecommerce';
        }
        if (lower.includes('blog') || lower.includes('post') || lower.includes('article')) {
            return 'blog';
        }
        if (lower.includes('dashboard') || lower.includes('analytics') || lower.includes('metrics')) {
            return 'dashboard';
        }
        if (lower.includes('landing') || lower.includes('marketing') || lower.includes('waitlist')) {
            return 'landing';
        }
        if (lower.includes('portfolio') || lower.includes('personal')) {
            return 'portfolio';
        }
        if (lower.includes('crud') || lower.includes('manage') || lower.includes('track')) {
            return 'crud';
        }
        
        return 'saas';
    }

    /**
     * Infer features from description
     */
    private inferFeatures(description: string): FeatureType[] {
        const features: FeatureType[] = ['database'];
        const lower = description.toLowerCase();

        if (lower.includes('login') || lower.includes('user') || lower.includes('account') || lower.includes('auth')) {
            features.push('auth');
        }
        if (lower.includes('upload') || lower.includes('image') || lower.includes('file')) {
            features.push('file-upload');
        }
        if (lower.includes('pay') || lower.includes('subscription') || lower.includes('stripe') || lower.includes('billing')) {
            features.push('payments');
        }
        if (lower.includes('email') || lower.includes('notification')) {
            features.push('email');
        }
        if (lower.includes('realtime') || lower.includes('live') || lower.includes('chat')) {
            features.push('realtime');
        }
        if (lower.includes('search')) {
            features.push('search');
        }
        if (lower.includes('admin') || lower.includes('moderate')) {
            features.push('admin');
        }
        if (lower.includes('google') || lower.includes('github') || lower.includes('oauth') || lower.includes('social')) {
            features.push('social-auth');
        }
        if (lower.includes('role') || lower.includes('permission') || lower.includes('team')) {
            features.push('rbac');
        }

        return features;
    }

    // Utility methods
    private toTitleCase(str: string): string {
        return str.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    private toSnakeCase(str: string): string {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }

    private pathToName(path: string): string {
        if (path === '/') return 'Home';
        return path.split('/').filter(Boolean)[0]
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join('');
    }
}

/**
 * Save spec to file
 */
export function saveSpec(spec: AppSpec, projectPath: string): string {
    const fs = require('fs');
    const path = require('path');
    
    const specPath = path.join(projectPath, 'liftoff.spec.json');
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    
    return specPath;
}

/**
 * Load spec from file
 */
export function loadSpec(projectPath: string): AppSpec | null {
    const fs = require('fs');
    const path = require('path');
    
    const specPath = path.join(projectPath, 'liftoff.spec.json');
    if (!fs.existsSync(specPath)) return null;
    
    return JSON.parse(fs.readFileSync(specPath, 'utf-8'));
}
