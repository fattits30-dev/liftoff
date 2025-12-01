/**
 * App Builder Types - Core data structures for building apps from specs
 */

// ============================================================================
// APP SPECIFICATION
// ============================================================================

export type AppType = 'saas' | 'dashboard' | 'landing' | 'crud' | 'ecommerce' | 'blog' | 'portfolio';

export type FeatureType = 
    | 'auth'           // User authentication (login, signup, logout)
    | 'database'       // Supabase tables + queries
    | 'file-upload'    // File/image storage
    | 'payments'       // Stripe integration
    | 'email'          // Transactional emails
    | 'realtime'       // Supabase realtime subscriptions
    | 'search'         // Full-text search
    | 'notifications'  // Push/in-app notifications
    | 'analytics'      // Usage tracking
    | 'admin'          // Admin dashboard
    | 'api'            // REST/GraphQL API
    | 'social-auth'    // OAuth (Google, GitHub, etc.)
    | 'rbac';          // Role-based access control

export type FieldType = 
    | 'text' 
    | 'number' 
    | 'boolean' 
    | 'date' 
    | 'datetime'
    | 'email'
    | 'url'
    | 'uuid'
    | 'json'
    | 'enum'
    | 'relation';  // Foreign key

export interface EntityField {
    name: string;
    type: FieldType;
    required: boolean;
    unique?: boolean;
    default?: string | number | boolean;
    enumValues?: string[];  // For enum type
    relationTo?: string;    // For relation type - target entity name
    relationField?: string; // For relation type - field name on target
}

export interface Entity {
    name: string;
    tableName: string;  // Supabase table name (snake_case)
    fields: EntityField[];
    timestamps: boolean;  // created_at, updated_at
    softDelete?: boolean; // deleted_at
    rls: boolean;         // Row-level security enabled
    rlsPolicy?: 'owner' | 'public-read' | 'team' | 'admin-only';
}

export interface PageRoute {
    path: string;
    name: string;
    component: string;
    layout?: 'default' | 'auth' | 'dashboard' | 'blank';
    protected: boolean;  // Requires authentication
    title?: string;
}

export interface AppSpec {
    // Metadata
    name: string;
    displayName: string;
    description: string;
    version: string;
    
    // App configuration
    type: AppType;
    features: FeatureType[];
    
    // Data model
    entities: Entity[];
    
    // UI structure
    pages: PageRoute[];
    
    // Tech stack (AI-researched and decided)
    stack: {
        frontend: string;      // e.g., 'react', 'vue', 'svelte', 'nextjs', 'solid'
        bundler?: string;      // e.g., 'vite', 'webpack', 'parcel', 'turbopack'
        styling: string;       // e.g., 'tailwind', 'styled-components', 'css-modules'
        components?: string;   // e.g., 'shadcn', 'mantine', 'chakra', 'mui'
        backend: string;       // e.g., 'supabase', 'firebase', 'express', 'fastify'
        database?: string;     // e.g., 'postgres', 'mongodb', 'sqlite', 'planetscale'
        auth?: string;         // e.g., 'supabase-auth', 'clerk', 'auth0', 'nextauth'
        hosting?: string;      // e.g., 'vercel', 'netlify', 'cloudflare', 'railway'
        realtime?: string;     // e.g., 'supabase-realtime', 'pusher', 'socket.io'
        rationale?: string;    // Why this stack was chosen
    };
    
    // Supabase project info (filled after setup)
    supabase?: {
        projectUrl?: string;
        anonKey?: string;
    };
}

// ============================================================================
// ARCHITECTURE
// ============================================================================

export interface DatabaseSchema {
    tables: TableSchema[];
    relationships: Relationship[];
    indexes: Index[];
    rlsPolicies: RLSPolicy[];
}

export interface TableSchema {
    name: string;
    columns: ColumnSchema[];
    primaryKey: string;
}

export interface ColumnSchema {
    name: string;
    type: string;  // PostgreSQL type
    nullable: boolean;
    default?: string;
    references?: {
        table: string;
        column: string;
        onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT';
    };
}

export interface Relationship {
    from: { table: string; column: string };
    to: { table: string; column: string };
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface Index {
    table: string;
    columns: string[];
    unique: boolean;
}

export interface RLSPolicy {
    name: string;
    table: string;
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
    using?: string;    // SQL expression
    withCheck?: string; // SQL expression
}

export interface ComponentTree {
    layouts: ComponentDef[];
    pages: ComponentDef[];
    components: ComponentDef[];
    hooks: HookDef[];
}

export interface ComponentDef {
    name: string;
    path: string;
    props?: Record<string, string>;
    children?: string[];
    imports?: string[];
}

export interface HookDef {
    name: string;
    path: string;
    description: string;
}

export interface Architecture {
    spec: AppSpec;
    database: DatabaseSchema;
    components: ComponentTree;
    apiRoutes: APIRoute[];
    envVars: EnvVar[];
}

export interface APIRoute {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    description: string;
    auth: boolean;
}

export interface EnvVar {
    name: string;
    description: string;
    required: boolean;
    example: string;
}

// ============================================================================
// BUILD PHASES
// ============================================================================

export type BuildPhase = 
    | 'spec'        // Gathering requirements
    | 'architecture' // Designing structure
    | 'scaffold'    // Creating project skeleton
    | 'implement'   // Building features
    | 'test'        // Verifying functionality
    | 'deploy';     // Shipping to production

export interface BuildState {
    phase: BuildPhase;
    spec?: AppSpec;
    architecture?: Architecture;
    projectPath?: string;
    completedFeatures: FeatureType[];
    failedFeatures: FeatureType[];
    todoItems: string[];
    logs: BuildLog[];
}

export interface BuildLog {
    timestamp: Date;
    phase: BuildPhase;
    action: string;
    status: 'started' | 'completed' | 'failed' | 'skipped';
    details?: string;
}

// ============================================================================
// TEMPLATES
// ============================================================================

export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    appType: AppType;
    features: FeatureType[];
    files: TemplateFile[];
}

export interface TemplateFile {
    path: string;
    content: string;
    templateVars?: string[];  // Variables like {{APP_NAME}} to replace
}

// ============================================================================
// SPEC QUESTIONS (for gathering requirements)
// ============================================================================

export interface SpecQuestion {
    id: string;
    question: string;
    type: 'text' | 'select' | 'multiselect' | 'confirm';
    options?: string[];
    default?: string | string[] | boolean;
    dependsOn?: { questionId: string; value: string | boolean };
}

export const SPEC_QUESTIONS: SpecQuestion[] = [
    {
        id: 'appType',
        question: 'What type of app are you building?',
        type: 'select',
        options: ['saas', 'dashboard', 'landing', 'crud', 'ecommerce', 'blog', 'portfolio'],
        default: 'saas'
    },
    {
        id: 'appName',
        question: 'What should we call this app? (lowercase, no spaces)',
        type: 'text',
        default: 'my-app'
    },
    {
        id: 'description',
        question: 'Briefly describe what this app does:',
        type: 'text'
    },
    {
        id: 'features',
        question: 'Which features do you need?',
        type: 'multiselect',
        options: ['auth', 'database', 'file-upload', 'payments', 'email', 'realtime', 'search', 'admin', 'social-auth', 'rbac'],
        default: ['auth', 'database']
    },
    {
        id: 'pages',
        question: 'What pages should the app have? (comma-separated)',
        type: 'text',
        default: 'Home, Login, Dashboard, Settings'
    },
    {
        id: 'hosting',
        question: 'Where will you deploy?',
        type: 'select',
        options: ['vercel', 'netlify'],
        default: 'vercel'
    }
];
