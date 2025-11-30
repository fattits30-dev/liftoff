/**
 * Feature Tasks - Maps features to implementation tasks for agents
 */

import { FeatureType, AppType, Entity } from './types';

export type AgentType = 'frontend' | 'backend' | 'testing' | 'browser' | 'general';

export interface TaskDefinition {
    name: string;
    agent: AgentType;
    prompt: string;
    dependsOn?: string[];
    verification: string;
    files?: string[];
}

export interface FeatureTaskSet {
    feature: FeatureType;
    tasks: TaskDefinition[];
}

/**
 * Core feature task definitions
 */
export const FEATURE_TASKS: Record<FeatureType, TaskDefinition[]> = {
    auth: [
        {
            name: 'auth-context',
            agent: 'frontend',
            prompt: `Create AuthContext provider at src/contexts/AuthContext.tsx that:
1. Uses Supabase auth
2. Provides user, loading, error state
3. Provides signIn(email, password), signUp(email, password), signOut() methods
4. Listens to auth state changes with onAuthStateChange
5. Exports useAuth() hook`,
            verification: 'File exports AuthProvider and useAuth hook',
            files: ['src/contexts/AuthContext.tsx']
        },
        {
            name: 'login-page',
            agent: 'frontend',
            prompt: `Create Login page at src/pages/LoginPage.tsx that:
1. Uses shadcn/ui Card, Input, Button, Label components
2. Has email and password fields with validation
3. Shows loading state during submission
4. Handles errors with toast notifications
5. Redirects to /dashboard on success
6. Has link to /signup page`,
            dependsOn: ['auth-context'],
            verification: 'Login page renders form and submits',
            files: ['src/pages/LoginPage.tsx']
        },
        {
            name: 'signup-page',
            agent: 'frontend',
            prompt: `Create Signup page at src/pages/SignupPage.tsx that:
1. Uses shadcn/ui Card, Input, Button, Label components
2. Has email, password, and confirm password fields
3. Validates password match
4. Shows loading state during submission
5. Handles errors with toast notifications
6. Shows success message to check email
7. Has link to /login page`,
            dependsOn: ['auth-context'],
            verification: 'Signup page renders form and submits',
            files: ['src/pages/SignupPage.tsx']
        },
        {
            name: 'protected-route',
            agent: 'frontend',
            prompt: `Create ProtectedRoute component at src/components/auth/ProtectedRoute.tsx that:
1. Uses useAuth() hook to check authentication
2. Shows loading spinner while checking auth
3. Redirects to /login if not authenticated
4. Renders children if authenticated
5. Preserves intended destination for redirect after login`,
            dependsOn: ['auth-context'],
            verification: 'Component redirects unauthenticated users',
            files: ['src/components/auth/ProtectedRoute.tsx']
        },
        {
            name: 'auth-tests',
            agent: 'testing',
            prompt: `Write Playwright e2e tests for auth at tests/auth.spec.ts:
1. Test login with valid credentials succeeds
2. Test login with invalid credentials shows error
3. Test signup creates new user
4. Test logout redirects to home
5. Test protected routes redirect when not logged in`,
            dependsOn: ['login-page', 'signup-page', 'protected-route'],
            verification: 'All auth tests pass',
            files: ['tests/auth.spec.ts']
        }
    ],

    database: [
        {
            name: 'supabase-client',
            agent: 'frontend',
            prompt: `Create Supabase client at src/lib/supabase.ts that:
1. Imports createClient from @supabase/supabase-js
2. Creates typed client using Database type from src/types/database.ts
3. Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from env
4. Exports supabase client as default`,
            verification: 'File exports configured supabase client',
            files: ['src/lib/supabase.ts']
        },
        {
            name: 'database-types',
            agent: 'frontend',
            prompt: `Create Database type file at src/types/database.ts that:
1. Exports Database interface matching Supabase schema
2. Includes Tables type with all entity tables
3. Includes Row, Insert, Update types for each table
4. Uses proper TypeScript types for all fields`,
            verification: 'File exports Database type',
            files: ['src/types/database.ts']
        },
        {
            name: 'entity-hooks',
            agent: 'frontend',
            prompt: `Create data hooks at src/hooks/useData.ts that:
1. Creates useQuery-style hooks for each entity
2. Implements list, get, create, update, delete operations
3. Uses Supabase client for all operations
4. Handles loading and error states
5. Returns typed data`,
            dependsOn: ['supabase-client', 'database-types'],
            verification: 'Hooks handle CRUD operations',
            files: ['src/hooks/useData.ts']
        }
    ],

    'file-upload': [
        {
            name: 'file-upload-hook',
            agent: 'frontend',
            prompt: `Create useFileUpload hook at src/hooks/useFileUpload.ts that:
1. Accepts bucket name and path parameters
2. Handles file selection and upload to Supabase storage
3. Provides progress tracking
4. Returns public URL after upload
5. Handles errors gracefully`,
            verification: 'Hook uploads files to Supabase storage',
            files: ['src/hooks/useFileUpload.ts']
        },
        {
            name: 'file-upload-component',
            agent: 'frontend',
            prompt: `Create FileUpload component at src/components/FileUpload.tsx that:
1. Uses useFileUpload hook
2. Has drag-and-drop zone
3. Shows file preview for images
4. Displays upload progress bar
5. Returns file URL via onChange callback
6. Supports multiple file types (images, documents)`,
            dependsOn: ['file-upload-hook'],
            verification: 'Component renders and uploads files',
            files: ['src/components/FileUpload.tsx']
        }
    ],

    payments: [
        {
            name: 'stripe-client',
            agent: 'frontend',
            prompt: `Create Stripe client at src/lib/stripe.ts that:
1. Initializes Stripe with VITE_STRIPE_PUBLIC_KEY
2. Exports loadStripe promise
3. Creates helper for checkout sessions`,
            verification: 'File exports stripe client',
            files: ['src/lib/stripe.ts']
        },
        {
            name: 'checkout-component',
            agent: 'frontend',
            prompt: `Create CheckoutButton component at src/components/payments/CheckoutButton.tsx that:
1. Creates Stripe checkout session via API
2. Redirects to Stripe checkout
3. Handles loading and error states`,
            dependsOn: ['stripe-client'],
            verification: 'Component initiates checkout',
            files: ['src/components/payments/CheckoutButton.tsx']
        },
        {
            name: 'pricing-page',
            agent: 'frontend',
            prompt: `Create Pricing page at src/pages/PricingPage.tsx that:
1. Shows pricing tiers in cards
2. Uses CheckoutButton for each tier
3. Highlights popular plan
4. Shows feature comparison`,
            dependsOn: ['checkout-component'],
            verification: 'Pricing page renders with checkout buttons',
            files: ['src/pages/PricingPage.tsx']
        }
    ],

    email: [
        {
            name: 'email-service',
            agent: 'backend',
            prompt: `Create email service at supabase/functions/send-email/index.ts that:
1. Uses Resend API for sending emails
2. Accepts to, subject, html parameters
3. Returns success/error response
4. Handles rate limiting`,
            verification: 'Edge function sends emails',
            files: ['supabase/functions/send-email/index.ts']
        }
    ],

    realtime: [
        {
            name: 'realtime-hook',
            agent: 'frontend',
            prompt: `Create useRealtime hook at src/hooks/useRealtime.ts that:
1. Subscribes to Supabase realtime channel
2. Accepts table name and filter
3. Handles INSERT, UPDATE, DELETE events
4. Returns live data with automatic updates
5. Cleans up subscription on unmount`,
            verification: 'Hook receives realtime updates',
            files: ['src/hooks/useRealtime.ts']
        }
    ],

    search: [
        {
            name: 'search-component',
            agent: 'frontend',
            prompt: `Create SearchBar component at src/components/SearchBar.tsx that:
1. Uses debounced input
2. Calls Supabase full-text search
3. Shows results in dropdown
4. Supports keyboard navigation
5. Highlights matching text`,
            verification: 'Component searches and shows results',
            files: ['src/components/SearchBar.tsx']
        }
    ],

    notifications: [
        {
            name: 'notification-provider',
            agent: 'frontend',
            prompt: `Create NotificationProvider at src/contexts/NotificationContext.tsx that:
1. Manages notification state
2. Provides addNotification, removeNotification methods
3. Auto-dismisses notifications after timeout
4. Supports different types (success, error, info, warning)`,
            verification: 'Provider manages notifications',
            files: ['src/contexts/NotificationContext.tsx']
        },
        {
            name: 'notification-center',
            agent: 'frontend',
            prompt: `Create NotificationCenter component at src/components/NotificationCenter.tsx that:
1. Shows toast notifications
2. Stacks multiple notifications
3. Has dismiss button
4. Uses shadcn/ui Toast component`,
            dependsOn: ['notification-provider'],
            verification: 'Component renders notifications',
            files: ['src/components/NotificationCenter.tsx']
        }
    ],

    analytics: [
        {
            name: 'analytics-provider',
            agent: 'frontend',
            prompt: `Create analytics at src/lib/analytics.ts that:
1. Initializes PostHog or Plausible
2. Provides track(event, properties) function
3. Provides identify(userId, traits) function
4. Auto-tracks page views`,
            verification: 'File exports analytics functions',
            files: ['src/lib/analytics.ts']
        }
    ],

    admin: [
        {
            name: 'admin-layout',
            agent: 'frontend',
            prompt: `Create AdminLayout at src/layouts/AdminLayout.tsx that:
1. Has sidebar with admin navigation
2. Shows current admin user
3. Has logout button
4. Requires admin role to access`,
            verification: 'Layout renders with admin sidebar',
            files: ['src/layouts/AdminLayout.tsx']
        },
        {
            name: 'admin-dashboard',
            agent: 'frontend',
            prompt: `Create AdminDashboard page at src/pages/admin/AdminDashboard.tsx that:
1. Shows key metrics cards
2. Has recent activity table
3. Shows charts for trends
4. Has quick action buttons`,
            dependsOn: ['admin-layout'],
            verification: 'Admin dashboard shows metrics',
            files: ['src/pages/admin/AdminDashboard.tsx']
        },
        {
            name: 'admin-users',
            agent: 'frontend',
            prompt: `Create AdminUsers page at src/pages/admin/AdminUsers.tsx that:
1. Lists all users in DataTable
2. Supports search and filter
3. Has pagination
4. Shows user details in sheet
5. Has edit and delete actions`,
            dependsOn: ['admin-layout'],
            verification: 'Admin users page shows user list',
            files: ['src/pages/admin/AdminUsers.tsx']
        }
    ],

    api: [
        {
            name: 'api-client',
            agent: 'frontend',
            prompt: `Create API client at src/lib/api.ts that:
1. Uses fetch with base URL
2. Adds auth token to requests
3. Handles JSON responses
4. Provides get, post, put, delete methods
5. Handles errors consistently`,
            verification: 'File exports API client',
            files: ['src/lib/api.ts']
        }
    ],

    'social-auth': [
        {
            name: 'oauth-buttons',
            agent: 'frontend',
            prompt: `Create OAuthButtons component at src/components/auth/OAuthButtons.tsx that:
1. Shows Google sign-in button
2. Shows GitHub sign-in button
3. Uses Supabase OAuth
4. Handles loading and error states
5. Has consistent styling`,
            verification: 'Component renders OAuth buttons',
            files: ['src/components/auth/OAuthButtons.tsx']
        }
    ],

    rbac: [
        {
            name: 'rbac-context',
            agent: 'frontend',
            prompt: `Create RoleContext at src/contexts/RoleContext.tsx that:
1. Fetches user role from profiles
2. Provides hasRole(role), hasPermission(permission) methods
3. Caches role data
4. Updates on auth change`,
            verification: 'Context provides role checking',
            files: ['src/contexts/RoleContext.tsx']
        },
        {
            name: 'role-guard',
            agent: 'frontend',
            prompt: `Create RoleGuard component at src/components/auth/RoleGuard.tsx that:
1. Accepts required role or permission
2. Shows children if authorized
3. Shows fallback or redirects if not
4. Works with ProtectedRoute`,
            dependsOn: ['rbac-context'],
            verification: 'Component guards by role',
            files: ['src/components/auth/RoleGuard.tsx']
        }
    ]
};

/**
 * Get tasks for a set of features in dependency order
 */
export function getOrderedTasks(features: FeatureType[]): TaskDefinition[] {
    const allTasks: TaskDefinition[] = [];
    const taskMap = new Map<string, TaskDefinition>();

    // Collect all tasks
    for (const feature of features) {
        const featureTasks = FEATURE_TASKS[feature];
        if (featureTasks) {
            for (const task of featureTasks) {
                taskMap.set(task.name, task);
                allTasks.push(task);
            }
        }
    }

    // Topological sort based on dependencies
    const sorted: TaskDefinition[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(task: TaskDefinition): void {
        if (visited.has(task.name)) return;
        if (visiting.has(task.name)) {
            throw new Error(`Circular dependency detected: ${task.name}`);
        }

        visiting.add(task.name);

        if (task.dependsOn) {
            for (const depName of task.dependsOn) {
                const depTask = taskMap.get(depName);
                if (depTask) {
                    visit(depTask);
                }
            }
        }

        visiting.delete(task.name);
        visited.add(task.name);
        sorted.push(task);
    }

    for (const task of allTasks) {
        visit(task);
    }

    return sorted;
}

/**
 * Generate entity-specific CRUD tasks
 */
export function generateEntityTasks(entity: Entity): TaskDefinition[] {
    const name = entity.name;
    const tableName = entity.tableName;

    return [
        {
            name: `${tableName}-list-page`,
            agent: 'frontend',
            prompt: `Create ${name} list page at src/pages/${name}ListPage.tsx that:
1. Fetches ${name}s from Supabase
2. Displays in DataTable with columns for ${entity.fields.map(f => f.name).join(', ')}
3. Has search and filter
4. Has pagination
5. Has link to create new
6. Has edit and delete actions`,
            verification: `${name} list page renders`,
            files: [`src/pages/${name}ListPage.tsx`]
        },
        {
            name: `${tableName}-form`,
            agent: 'frontend',
            prompt: `Create ${name} form component at src/components/${name}Form.tsx that:
1. Has fields for ${entity.fields.filter(f => f.name !== 'id').map(f => f.name).join(', ')}
2. Uses react-hook-form for validation
3. Uses shadcn/ui form components
4. Handles both create and edit modes
5. Submits to Supabase`,
            verification: `${name} form validates and submits`,
            files: [`src/components/${name}Form.tsx`]
        },
        {
            name: `${tableName}-create-page`,
            agent: 'frontend',
            prompt: `Create ${name} create page at src/pages/${name}CreatePage.tsx that:
1. Uses ${name}Form component
2. Handles submission
3. Shows success message
4. Redirects to list on success`,
            dependsOn: [`${tableName}-form`],
            verification: `Create ${name} page works`,
            files: [`src/pages/${name}CreatePage.tsx`]
        },
        {
            name: `${tableName}-edit-page`,
            agent: 'frontend',
            prompt: `Create ${name} edit page at src/pages/${name}EditPage.tsx that:
1. Fetches existing ${name} by ID from URL
2. Uses ${name}Form component in edit mode
3. Pre-fills form with existing data
4. Handles update
5. Redirects to list on success`,
            dependsOn: [`${tableName}-form`],
            verification: `Edit ${name} page works`,
            files: [`src/pages/${name}EditPage.tsx`]
        }
    ];
}

/**
 * Get all tasks for an app type with default features
 */
export function getAppTypeTasks(appType: AppType, entities: Entity[]): TaskDefinition[] {
    // Default features for each app type
    const defaultFeatures: Record<AppType, FeatureType[]> = {
        saas: ['auth', 'database', 'rbac'],
        dashboard: ['auth', 'database'],
        landing: [],
        crud: ['auth', 'database'],
        ecommerce: ['auth', 'database', 'payments', 'file-upload'],
        blog: ['auth', 'database', 'search'],
        portfolio: ['database']
    };

    const features = defaultFeatures[appType] || ['database'];
    const tasks = getOrderedTasks(features);

    // Add entity-specific tasks
    for (const entity of entities) {
        if (entity.tableName !== 'profiles') {
            tasks.push(...generateEntityTasks(entity));
        }
    }

    return tasks;
}
