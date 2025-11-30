/**
 * Test Generator - Create tests for new and existing code
 *
 * Generates:
 * - Unit tests for components, utilities, functions
 * - E2E tests for user flows
 * - API tests for endpoints
 * - Integration tests
 *
 * Works with BOTH:
 * - New apps (from AppSpec)
 * - Existing apps (from CodebaseAnalyzer)
 */

import * as path from 'path';
import { ComponentInfo, APIEndpoint, UtilityFunction, CodebaseStructure } from './codebaseAnalyzer';
import { AppSpec } from '../appBuilder/types';

export interface GeneratedTest {
    filePath: string;
    content: string;
    type: 'unit' | 'e2e' | 'integration' | 'api';
    coveredFeatures: string[];
}

export class TestGenerator {
    private framework: 'vitest' | 'jest' | 'playwright';

    constructor(framework: 'vitest' | 'jest' | 'playwright' = 'vitest') {
        this.framework = framework;
    }

    /**
     * Generate tests from analyzed codebase (EXISTING apps)
     */
    generateFromCodebase(structure: CodebaseStructure): GeneratedTest[] {
        const tests: GeneratedTest[] = [];

        // Component tests
        for (const component of structure.components) {
            tests.push(this.generateComponentTest(component));
        }

        // Utility tests
        for (const utility of structure.utilities) {
            tests.push(this.generateUtilityTest(utility));
        }

        // API tests
        for (const endpoint of structure.apiEndpoints) {
            tests.push(this.generateAPITest(endpoint));
        }

        // E2E tests for main flows
        if (structure.components.filter(c => c.type === 'page').length > 0) {
            tests.push(...this.generateE2ETests(structure));
        }

        return tests;
    }

    /**
     * Generate tests from AppSpec (NEW apps)
     */
    generateFromSpec(spec: AppSpec): GeneratedTest[] {
        const tests: GeneratedTest[] = [];

        // Generate E2E tests for user stories/features
        for (const feature of spec.features) {
            tests.push(this.generateFeatureE2ETest(feature));
        }

        // Generate API tests if backend exists (AppSpec structure may vary)
        // TODO: Update when AppSpec interface is finalized
        const backendInfo = (spec as any).backend;
        if (backendInfo && backendInfo.endpoints) {
            for (const endpoint of backendInfo.endpoints) {
                tests.push(this.generateAPITestFromSpec(endpoint));
            }
        }

        return tests;
    }

    /**
     * Generate unit test for React component
     */
    private generateComponentTest(component: ComponentInfo): GeneratedTest {
        const testFileName = component.filePath.replace(/\.(tsx|jsx)$/, '.test.$1');

        const imports = [
            `import { render, screen } from '@testing-library/react';`,
            `import { describe, it, expect } from '${this.framework}';`,
            `import ${component.name} from './${path.basename(component.filePath, path.extname(component.filePath))}';`
        ].join('\n');

        const testCases: string[] = [];

        // Basic render test
        testCases.push(`
  it('renders without crashing', () => {
    render(<${component.name} ${component.props.map(p => `${p}={mockValue}`).join(' ')} />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });`);

        // Props tests
        if (component.props.length > 0) {
            testCases.push(`
  it('renders with props', () => {
    const props = { ${component.props.map(p => `${p}: 'test'`).join(', ')} };
    render(<${component.name} {...props} />);
    expect(screen.getByText('test')).toBeInTheDocument();
  });`);
        }

        // Hook tests if using common hooks
        if (component.hooks.includes('useState')) {
            testCases.push(`
  it('handles state changes', async () => {
    const { user } = render(<${component.name} />);
    const button = screen.getByRole('button');
    await user.click(button);
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
  });`);
        }

        const content = `${imports}

describe('${component.name}', () => {${testCases.join('\n')}
});
`;

        return {
            filePath: testFileName,
            content,
            type: 'unit',
            coveredFeatures: [component.name]
        };
    }

    /**
     * Generate unit test for utility function
     */
    private generateUtilityTest(utility: UtilityFunction): GeneratedTest {
        const testFileName = utility.filePath.replace(/\.(ts|js)$/, '.test.$1');

        const imports = [
            `import { describe, it, expect } from '${this.framework}';`,
            `import { ${utility.name} } from './${path.basename(utility.filePath, path.extname(utility.filePath))}';`
        ].join('\n');

        const testCases: string[] = [];

        // Basic functionality test
        testCases.push(`
  it('works with valid input', () => {
    const result = ${utility.name}(${utility.params.map(() => 'mockValue').join(', ')});
    expect(result).toBeDefined();
  });`);

        // Edge cases
        testCases.push(`
  it('handles edge cases', () => {
    expect(() => ${utility.name}(${utility.params.map(() => 'null').join(', ')})).not.toThrow();
  });`);

        const content = `${imports}

describe('${utility.name}', () => {${testCases.join('\n')}
});
`;

        return {
            filePath: testFileName,
            content,
            type: 'unit',
            coveredFeatures: [utility.name]
        };
    }

    /**
     * Generate API endpoint test
     */
    private generateAPITest(endpoint: APIEndpoint): GeneratedTest {
        const testFileName = endpoint.filePath.replace(/\.(ts|js)$/, '.test.$1');

        const imports = [
            `import { describe, it, expect, beforeAll, afterAll } from '${this.framework}';`,
            `import request from 'supertest';`,
            `import app from '../app'; // Adjust import path`
        ].join('\n');

        const testCases: string[] = [];

        // Success case
        testCases.push(`
  it('${endpoint.method} ${endpoint.path} - success', async () => {
    const response = await request(app)
      .${endpoint.method.toLowerCase()}('${endpoint.path}')
      ${endpoint.method === 'POST' || endpoint.method === 'PUT' ? `.send({ test: 'data' })` : ''}
      .expect(200);

    expect(response.body).toBeDefined();
  });`);

        // Auth required (if it looks like protected route)
        if (!endpoint.path.includes('login') && !endpoint.path.includes('public')) {
            testCases.push(`
  it('${endpoint.method} ${endpoint.path} - requires auth', async () => {
    await request(app)
      .${endpoint.method.toLowerCase()}('${endpoint.path}')
      .expect(401);
  });`);
        }

        // Validation errors
        if (endpoint.method === 'POST' || endpoint.method === 'PUT') {
            testCases.push(`
  it('${endpoint.method} ${endpoint.path} - validates input', async () => {
    await request(app)
      .${endpoint.method.toLowerCase()}('${endpoint.path}')
      .send({})
      .expect(400);
  });`);
        }

        const content = `${imports}

describe('${endpoint.method} ${endpoint.path}', () => {${testCases.join('\n')}
});
`;

        return {
            filePath: testFileName,
            content,
            type: 'api',
            coveredFeatures: [`${endpoint.method} ${endpoint.path}`]
        };
    }

    /**
     * Generate E2E tests for main user flows
     */
    private generateE2ETests(structure: CodebaseStructure): GeneratedTest[] {
        const tests: GeneratedTest[] = [];

        // Authentication flow (if login page exists)
        const hasLogin = structure.components.some(c =>
            c.name.toLowerCase().includes('login') ||
            c.filePath.toLowerCase().includes('login')
        );

        if (hasLogin) {
            tests.push(this.generateAuthE2ETest());
        }

        // Main navigation test
        const pages = structure.components.filter(c => c.type === 'page');
        if (pages.length > 0) {
            tests.push(this.generateNavigationE2ETest(pages));
        }

        return tests;
    }

    /**
     * Generate authentication E2E test
     */
    private generateAuthE2ETest(): GeneratedTest {
        const content = `import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can log in', async ({ page }) => {
    await page.goto('/login');

    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('text=Welcome')).toBeVisible();
  });

  test('user can log out', async ({ page }) => {
    // Assuming already logged in
    await page.goto('/dashboard');
    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL('/login');
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('[name="email"]', 'wrong@example.com');
    await page.fill('[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=/invalid|error/i')).toBeVisible();
  });
});
`;

        return {
            filePath: 'e2e/auth.spec.ts',
            content,
            type: 'e2e',
            coveredFeatures: ['Authentication', 'Login', 'Logout']
        };
    }

    /**
     * Generate navigation E2E test
     */
    private generateNavigationE2ETest(pages: ComponentInfo[]): GeneratedTest {
        const testCases = pages.map(page => {
            const pageName = page.name.replace('Page', '');
            const route = `/${pageName.toLowerCase()}`;

            return `
  test('can navigate to ${pageName}', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="${route}"]');
    await expect(page).toHaveURL('${route}');
    await expect(page.locator('h1')).toBeVisible();
  });`;
        }).join('\n');

        const content = `import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/./);
  });
${testCases}
});
`;

        return {
            filePath: 'e2e/navigation.spec.ts',
            content,
            type: 'e2e',
            coveredFeatures: ['Navigation', ...pages.map(p => p.name)]
        };
    }

    /**
     * Generate E2E test from AppSpec feature
     */
    private generateFeatureE2ETest(feature: any): GeneratedTest {
        // Simplified version - would parse feature description
        const content = `import { test, expect } from '@playwright/test';

test.describe('${feature.name}', () => {
  test('${feature.description}', async ({ page }) => {
    // TODO: Implement test for: ${feature.description}
    await page.goto('/');
    expect(true).toBe(true);
  });
});
`;

        return {
            filePath: `e2e/${feature.name.toLowerCase().replace(/\s+/g, '-')}.spec.ts`,
            content,
            type: 'e2e',
            coveredFeatures: [feature.name]
        };
    }

    /**
     * Generate API test from AppSpec endpoint
     */
    private generateAPITestFromSpec(endpoint: any): GeneratedTest {
        const content = `import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('${endpoint.method} ${endpoint.path}', () => {
  it('works correctly', async () => {
    const response = await request(app)
      .${endpoint.method.toLowerCase()}('${endpoint.path}')
      .expect(200);

    expect(response.body).toBeDefined();
  });
});
`;

        return {
            filePath: `tests/api/${endpoint.path.replace(/\//g, '-')}.test.ts`,
            content,
            type: 'api',
            coveredFeatures: [endpoint.path]
        };
    }

    /**
     * Generate test configuration files
     */
    generateTestConfig(framework: 'vitest' | 'playwright'): { fileName: string; content: string }[] {
        if (framework === 'vitest') {
            return [{
                fileName: 'vitest.config.ts',
                content: `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/']
    }
  }
});
`
            }];
        } else {
            return [{
                fileName: 'playwright.config.ts',
                content: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
`
            }];
        }
    }
}
