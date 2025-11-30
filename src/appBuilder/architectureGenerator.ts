/**
 * Architecture Generator - Creates technical architecture from AppSpec
 */

import {
    AppSpec,
    Architecture,
    DatabaseSchema,
    TableSchema,
    ColumnSchema,
    Relationship,
    Index,
    RLSPolicy,
    ComponentTree,
    ComponentDef,
    HookDef,
    APIRoute,
    EnvVar,
    Entity,
    EntityField,
    FeatureType,
    PageRoute,
    FieldType
} from './types';

/**
 * Maps EntityField types to PostgreSQL types
 */
const FIELD_TYPE_TO_PG: Record<FieldType, string> = {
    text: 'TEXT',
    number: 'INTEGER',
    boolean: 'BOOLEAN',
    date: 'DATE',
    datetime: 'TIMESTAMPTZ',
    email: 'TEXT',
    url: 'TEXT',
    uuid: 'UUID',
    json: 'JSONB',
    enum: 'TEXT',
    relation: 'UUID'
};

export class ArchitectureGenerator {

    /**
     * Generate full architecture from spec
     */
    generateArchitecture(spec: AppSpec): Architecture {
        return {
            spec,
            database: this.generateDatabaseSchema(spec.entities),
            components: this.generateComponentTree(spec.pages, spec.features, spec.type),
            apiRoutes: this.generateAPIRoutes(spec.entities, spec.features),
            envVars: this.generateEnvVars(spec.features)
        };
    }

    /**
     * Convert entities to PostgreSQL schema
     */
    generateDatabaseSchema(entities: Entity[]): DatabaseSchema {
        const tables: TableSchema[] = [];
        const relationships: Relationship[] = [];
        const indexes: Index[] = [];
        const rlsPolicies: RLSPolicy[] = [];

        for (const entity of entities) {
            // Generate table schema
            const columns: ColumnSchema[] = [];

            for (const field of entity.fields) {
                const column = this.fieldToColumn(field, entity);
                columns.push(column);

                // Track relationships
                if (field.type === 'relation' && field.relationTo) {
                    relationships.push({
                        from: { table: entity.tableName, column: field.name },
                        to: { table: this.toSnakeCase(field.relationTo), column: field.relationField || 'id' },
                        type: 'one-to-many'
                    });
                }
            }

            // Add timestamp columns
            if (entity.timestamps) {
                columns.push({
                    name: 'created_at',
                    type: 'TIMESTAMPTZ',
                    nullable: false,
                    default: 'NOW()'
                });
                columns.push({
                    name: 'updated_at',
                    type: 'TIMESTAMPTZ',
                    nullable: false,
                    default: 'NOW()'
                });
            }

            // Add soft delete column
            if (entity.softDelete) {
                columns.push({
                    name: 'deleted_at',
                    type: 'TIMESTAMPTZ',
                    nullable: true
                });
            }

            tables.push({
                name: entity.tableName,
                columns,
                primaryKey: 'id'
            });

            // Generate indexes for foreign keys and common queries
            for (const field of entity.fields) {
                if (field.type === 'relation') {
                    indexes.push({
                        table: entity.tableName,
                        columns: [field.name],
                        unique: false
                    });
                }
                if (field.unique) {
                    indexes.push({
                        table: entity.tableName,
                        columns: [field.name],
                        unique: true
                    });
                }
            }

            // Generate RLS policies
            if (entity.rls) {
                const policies = this.generateRLSPolicies(entity);
                rlsPolicies.push(...policies);
            }
        }

        return { tables, relationships, indexes, rlsPolicies };
    }

    /**
     * Convert entity field to column schema
     */
    private fieldToColumn(field: EntityField, _entity: Entity): ColumnSchema {
        const column: ColumnSchema = {
            name: field.name,
            type: FIELD_TYPE_TO_PG[field.type] || 'TEXT',
            nullable: !field.required
        };

        // Handle UUID with default
        if (field.type === 'uuid' && field.name === 'id') {
            column.default = 'gen_random_uuid()';
        }

        // Handle default values
        if (field.default !== undefined) {
            if (typeof field.default === 'string') {
                column.default = `'${field.default}'`;
            } else if (typeof field.default === 'boolean') {
                column.default = field.default.toString().toUpperCase();
            } else {
                column.default = String(field.default);
            }
        }

        // Handle foreign key references
        if (field.type === 'relation' && field.relationTo) {
            column.references = {
                table: this.toSnakeCase(field.relationTo),
                column: field.relationField || 'id',
                onDelete: 'CASCADE'
            };
        }

        return column;
    }

    /**
     * Generate RLS policies for an entity
     */
    private generateRLSPolicies(entity: Entity): RLSPolicy[] {
        const policies: RLSPolicy[] = [];
        const table = entity.tableName;

        // Enable RLS policy
        policies.push({
            name: `enable_rls_${table}`,
            table,
            operation: 'ALL',
            using: 'true' // Placeholder, actual RLS needs to be enabled separately
        });

        switch (entity.rlsPolicy) {
            case 'owner':
                // Only owner can CRUD
                policies.push({
                    name: `${table}_select_own`,
                    table,
                    operation: 'SELECT',
                    using: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                policies.push({
                    name: `${table}_insert_own`,
                    table,
                    operation: 'INSERT',
                    withCheck: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                policies.push({
                    name: `${table}_update_own`,
                    table,
                    operation: 'UPDATE',
                    using: `auth.uid() = ${this.findOwnerField(entity)}`,
                    withCheck: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                policies.push({
                    name: `${table}_delete_own`,
                    table,
                    operation: 'DELETE',
                    using: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                break;

            case 'public-read':
                // Anyone can read, only owner can write
                policies.push({
                    name: `${table}_select_all`,
                    table,
                    operation: 'SELECT',
                    using: 'true'
                });
                policies.push({
                    name: `${table}_insert_auth`,
                    table,
                    operation: 'INSERT',
                    withCheck: 'auth.uid() IS NOT NULL'
                });
                policies.push({
                    name: `${table}_update_own`,
                    table,
                    operation: 'UPDATE',
                    using: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                policies.push({
                    name: `${table}_delete_own`,
                    table,
                    operation: 'DELETE',
                    using: `auth.uid() = ${this.findOwnerField(entity)}`
                });
                break;

            case 'admin-only':
                // Only admins can access
                policies.push({
                    name: `${table}_admin_all`,
                    table,
                    operation: 'ALL',
                    using: `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
                });
                break;

            case 'team':
                // Team members can access
                policies.push({
                    name: `${table}_team_select`,
                    table,
                    operation: 'SELECT',
                    using: `EXISTS (SELECT 1 FROM team_members WHERE team_id = ${table}.team_id AND user_id = auth.uid())`
                });
                break;
        }

        return policies;
    }

    /**
     * Find the owner field name in an entity
     */
    private findOwnerField(entity: Entity): string {
        const ownerFields = ['owner_id', 'user_id', 'author_id', 'created_by'];
        for (const field of entity.fields) {
            if (ownerFields.includes(field.name)) {
                return field.name;
            }
        }
        // Fallback: if entity is profiles, use id
        if (entity.tableName === 'profiles') {
            return 'id';
        }
        return 'owner_id';
    }

    /**
     * Plan component hierarchy
     */
    generateComponentTree(pages: PageRoute[], features: FeatureType[], appType: string): ComponentTree {
        const layouts: ComponentDef[] = [];
        const pageComponents: ComponentDef[] = [];
        const components: ComponentDef[] = [];
        const hooks: HookDef[] = [];

        // Generate layouts
        layouts.push({
            name: 'RootLayout',
            path: 'src/layouts/RootLayout.tsx',
            children: ['Header', 'Outlet', 'Footer']
        });

        if (features.includes('auth')) {
            layouts.push({
                name: 'AuthLayout',
                path: 'src/layouts/AuthLayout.tsx',
                children: ['Outlet']
            });
        }

        if (appType === 'saas' || appType === 'dashboard' || appType === 'crud') {
            layouts.push({
                name: 'DashboardLayout',
                path: 'src/layouts/DashboardLayout.tsx',
                children: ['Sidebar', 'Header', 'Outlet']
            });
        }

        // Generate page components
        for (const page of pages) {
            pageComponents.push({
                name: page.component,
                path: `src/pages/${page.component}.tsx`,
                props: {}
            });
        }

        // Generate shared components
        components.push(
            { name: 'Header', path: 'src/components/Header.tsx' },
            { name: 'Footer', path: 'src/components/Footer.tsx' }
        );

        if (appType === 'saas' || appType === 'dashboard') {
            components.push({ name: 'Sidebar', path: 'src/components/Sidebar.tsx' });
        }

        // Feature-specific components
        if (features.includes('auth')) {
            components.push(
                { name: 'LoginForm', path: 'src/components/auth/LoginForm.tsx' },
                { name: 'SignupForm', path: 'src/components/auth/SignupForm.tsx' },
                { name: 'ProtectedRoute', path: 'src/components/auth/ProtectedRoute.tsx' }
            );
            hooks.push(
                { name: 'useAuth', path: 'src/hooks/useAuth.ts', description: 'Authentication state and methods' }
            );
        }

        if (features.includes('database')) {
            hooks.push(
                { name: 'useSupabase', path: 'src/hooks/useSupabase.ts', description: 'Supabase client hook' }
            );
        }

        if (features.includes('file-upload')) {
            components.push(
                { name: 'FileUpload', path: 'src/components/FileUpload.tsx' }
            );
            hooks.push(
                { name: 'useFileUpload', path: 'src/hooks/useFileUpload.ts', description: 'File upload to Supabase storage' }
            );
        }

        if (features.includes('realtime')) {
            hooks.push(
                { name: 'useRealtime', path: 'src/hooks/useRealtime.ts', description: 'Supabase realtime subscriptions' }
            );
        }

        return { layouts, pages: pageComponents, components, hooks };
    }

    /**
     * Generate API routes based on entities and features
     */
    generateAPIRoutes(entities: Entity[], features: FeatureType[]): APIRoute[] {
        const routes: APIRoute[] = [];

        // CRUD routes for each entity
        for (const entity of entities) {
            if (entity.tableName === 'profiles') continue; // Handled by auth

            const basePath = `/api/${entity.tableName}`;

            routes.push(
                {
                    method: 'GET',
                    path: basePath,
                    description: `List all ${entity.name}s`,
                    auth: true
                },
                {
                    method: 'GET',
                    path: `${basePath}/:id`,
                    description: `Get ${entity.name} by ID`,
                    auth: true
                },
                {
                    method: 'POST',
                    path: basePath,
                    description: `Create new ${entity.name}`,
                    auth: true
                },
                {
                    method: 'PUT',
                    path: `${basePath}/:id`,
                    description: `Update ${entity.name}`,
                    auth: true
                },
                {
                    method: 'DELETE',
                    path: `${basePath}/:id`,
                    description: `Delete ${entity.name}`,
                    auth: true
                }
            );
        }

        // Feature-specific routes
        if (features.includes('file-upload')) {
            routes.push({
                method: 'POST',
                path: '/api/upload',
                description: 'Upload file to storage',
                auth: true
            });
        }

        if (features.includes('search')) {
            routes.push({
                method: 'GET',
                path: '/api/search',
                description: 'Full-text search',
                auth: false
            });
        }

        return routes;
    }

    /**
     * Generate environment variables based on features
     */
    generateEnvVars(features: FeatureType[]): EnvVar[] {
        const envVars: EnvVar[] = [
            {
                name: 'VITE_SUPABASE_URL',
                description: 'Supabase project URL',
                required: true,
                example: 'https://xxx.supabase.co'
            },
            {
                name: 'VITE_SUPABASE_ANON_KEY',
                description: 'Supabase anonymous key',
                required: true,
                example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
            }
        ];

        if (features.includes('payments')) {
            envVars.push(
                {
                    name: 'VITE_STRIPE_PUBLIC_KEY',
                    description: 'Stripe publishable key',
                    required: true,
                    example: 'pk_test_...'
                },
                {
                    name: 'STRIPE_SECRET_KEY',
                    description: 'Stripe secret key (server-side only)',
                    required: true,
                    example: 'sk_test_...'
                }
            );
        }

        if (features.includes('email')) {
            envVars.push({
                name: 'RESEND_API_KEY',
                description: 'Resend API key for emails',
                required: true,
                example: 're_...'
            });
        }

        if (features.includes('analytics')) {
            envVars.push({
                name: 'VITE_POSTHOG_KEY',
                description: 'PostHog project key',
                required: false,
                example: 'phc_...'
            });
        }

        return envVars;
    }

    /**
     * Generate Supabase migration SQL
     */
    generateMigrationSQL(schema: DatabaseSchema): string {
        const lines: string[] = [];

        lines.push('-- Liftoff Generated Migration');
        lines.push('-- Run this in Supabase SQL Editor');
        lines.push('');

        // Enable UUID extension
        lines.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        lines.push('');

        // Create tables
        for (const table of schema.tables) {
            lines.push(`-- Table: ${table.name}`);
            lines.push(`CREATE TABLE IF NOT EXISTS ${table.name} (`);

            const columnDefs: string[] = [];
            for (const col of table.columns) {
                let def = `    ${col.name} ${col.type}`;
                if (!col.nullable) def += ' NOT NULL';
                if (col.default) def += ` DEFAULT ${col.default}`;
                if (col.references) {
                    def += ` REFERENCES ${col.references.table}(${col.references.column}) ON DELETE ${col.references.onDelete}`;
                }
                columnDefs.push(def);
            }

            // Add primary key
            columnDefs.push(`    PRIMARY KEY (${table.primaryKey})`);

            lines.push(columnDefs.join(',\n'));
            lines.push(');');
            lines.push('');
        }

        // Create indexes
        for (const idx of schema.indexes) {
            const unique = idx.unique ? 'UNIQUE ' : '';
            const name = `idx_${idx.table}_${idx.columns.join('_')}`;
            lines.push(`CREATE ${unique}INDEX IF NOT EXISTS ${name} ON ${idx.table} (${idx.columns.join(', ')});`);
        }
        lines.push('');

        // Enable RLS and create policies
        for (const table of schema.tables) {
            lines.push(`ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY;`);
        }
        lines.push('');

        for (const policy of schema.rlsPolicies) {
            if (policy.name.startsWith('enable_rls_')) continue;

            let policySQL = `CREATE POLICY "${policy.name}" ON ${policy.table}`;
            policySQL += ` FOR ${policy.operation}`;

            if (policy.using) {
                policySQL += ` USING (${policy.using})`;
            }
            if (policy.withCheck) {
                policySQL += ` WITH CHECK (${policy.withCheck})`;
            }
            policySQL += ';';

            lines.push(policySQL);
        }

        // Create updated_at trigger function
        lines.push('');
        lines.push('-- Updated at trigger');
        lines.push(`
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';
`);

        // Add trigger to each table with timestamps
        for (const table of schema.tables) {
            if (table.columns.some(c => c.name === 'updated_at')) {
                lines.push(`
CREATE TRIGGER update_${table.name}_updated_at
    BEFORE UPDATE ON ${table.name}
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Utility: Convert string to snake_case
     */
    private toSnakeCase(str: string): string {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }
}

/**
 * Generate architecture from spec (convenience function)
 */
export function generateArchitecture(spec: AppSpec): Architecture {
    const generator = new ArchitectureGenerator();
    return generator.generateArchitecture(spec);
}

/**
 * Generate migration SQL (convenience function)
 */
export function generateMigrationSQL(architecture: Architecture): string {
    const generator = new ArchitectureGenerator();
    return generator.generateMigrationSQL(architecture.database);
}
