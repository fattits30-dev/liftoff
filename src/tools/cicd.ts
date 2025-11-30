/**
 * CI/CD Workflow Generators for Liftoff
 * 
 * Generate GitHub Actions, GitLab CI, and other CI/CD configurations
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { ProjectInfo } from './appDev';

// ============================================================================
// Types
// ============================================================================

export type CIProvider = 'github' | 'gitlab' | 'circleci';

export interface WorkflowOptions {
    name?: string;
    branches?: string[];
    nodeVersion?: string;
    pythonVersion?: string;
    runTests?: boolean;
    runLint?: boolean;
    runBuild?: boolean;
    deployTarget?: 'vercel' | 'netlify' | 'docker' | 'none';
    cacheEnabled?: boolean;
}

// ============================================================================
// GitHub Actions Workflows
// ============================================================================

export function generateGitHubActionsCI(
    projectInfo: ProjectInfo,
    options: WorkflowOptions = {}
): string {
    const {
        name = 'CI',
        branches = ['main', 'master'],
        nodeVersion = '20',
        pythonVersion = '3.12',
        runTests = true,
        runLint = true,
        runBuild = true,
        cacheEnabled = true
    } = options;

    const isPython = ['django', 'flask', 'fastapi'].includes(projectInfo.framework);
    const pm = projectInfo.packageManager;
    const pmInstall = pm === 'npm' ? 'npm ci' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : `${pm} install`;
    const pmRun = pm === 'npm' ? 'npm run' : pm;

    if (isPython) {
        return `name: ${name}

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '${pythonVersion}'
${cacheEnabled ? `          cache: 'pip'` : ''}
      
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
${runLint ? `
      - name: Lint with ruff
        run: |
          pip install ruff
          ruff check .
` : ''}
${runTests ? `
      - name: Run tests
        run: pytest -v --tb=short
` : ''}
`;
    }

    // Node.js based projects
    return `name: ${name}

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'
${cacheEnabled && pm !== 'bun' ? `          cache: '${pm}'` : ''}
${pm === 'bun' ? `
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
` : ''}
      
      - name: Install dependencies
        run: ${pmInstall}
${runLint ? `
      - name: Lint
        run: ${pmRun} lint
` : ''}
${runBuild ? `
      - name: Build
        run: ${pmRun} build
` : ''}
${runTests && projectInfo.hasTests ? `
      - name: Test
        run: ${pmRun} test
` : ''}
`;
}

export function generateGitHubActionsDeployVercel(
    branches: string[] = ['main']
): string {
    return `name: Deploy to Vercel

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

env:
  VERCEL_ORG_ID: \${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: \${{ secrets.VERCEL_PROJECT_ID }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
      
      - name: Pull Vercel Environment Information
        run: vercel pull --yes --environment=production --token=\${{ secrets.VERCEL_TOKEN }}
      
      - name: Build Project
        run: vercel build --prod --token=\${{ secrets.VERCEL_TOKEN }}
      
      - name: Deploy to Vercel
        run: vercel deploy --prebuilt --prod --token=\${{ secrets.VERCEL_TOKEN }}
`;
}

export function generateGitHubActionsDeployDocker(
    imageName: string,
    registry: 'ghcr' | 'dockerhub' = 'ghcr'
): string {
    const registryUrl = registry === 'ghcr' ? 'ghcr.io' : 'docker.io';
    const loginStep = registry === 'ghcr' 
        ? `      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}`
        : `      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}`;

    return `name: Build and Push Docker

on:
  push:
    branches: ['main']
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

${loginStep}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${registryUrl}/\${{ github.repository_owner }}/${imageName}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
}

export function generateGitHubActionsRelease(): string {
    return `name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Generate changelog
        id: changelog
        uses: orhun/git-cliff-action@v3
        with:
          config: cliff.toml
          args: --latest --strip header
        env:
          OUTPUT: CHANGELOG.md
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          body: \${{ steps.changelog.outputs.content }}
          draft: false
          prerelease: \${{ contains(github.ref, 'alpha') || contains(github.ref, 'beta') || contains(github.ref, 'rc') }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

export function generateDependabot(): string {
    return `version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      dependencies:
        patterns:
          - "*"
        exclude-patterns:
          - "@types/*"
      types:
        patterns:
          - "@types/*"
    commit-message:
      prefix: "deps"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    commit-message:
      prefix: "ci"
`;
}

// ============================================================================
// GitLab CI
// ============================================================================

export function generateGitLabCI(
    projectInfo: ProjectInfo,
    options: WorkflowOptions = {}
): string {
    const {
        nodeVersion = '20',
        pythonVersion = '3.12',
        runTests = true,
        runLint = true,
        runBuild = true
    } = options;

    const isPython = ['django', 'flask', 'fastapi'].includes(projectInfo.framework);
    const pm = projectInfo.packageManager;

    if (isPython) {
        return `image: python:${pythonVersion}

stages:
  - test
${runBuild ? '  - build' : ''}

variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"

cache:
  paths:
    - .pip-cache/
    - venv/

before_script:
  - python -m venv venv
  - source venv/bin/activate
  - pip install -r requirements.txt
${runLint ? `
lint:
  stage: test
  script:
    - pip install ruff
    - ruff check .
` : ''}
${runTests ? `
test:
  stage: test
  script:
    - pytest -v --tb=short
  coverage: '/TOTAL.*\\s+(\\d+%)/'
` : ''}
`;
    }

    // Node.js
    return `image: node:${nodeVersion}

stages:
  - test
${runBuild ? '  - build' : ''}

cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/
    - .npm/

before_script:
  - ${pm === 'npm' ? 'npm ci' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : `${pm} install`}
${runLint ? `
lint:
  stage: test
  script:
    - ${pm === 'npm' ? 'npm run' : pm} lint
` : ''}
${runTests && projectInfo.hasTests ? `
test:
  stage: test
  script:
    - ${pm === 'npm' ? 'npm run' : pm} test
  coverage: '/All files[^|]*\\|[^|]*\\s+([\\d\\.]+)/'
` : ''}
${runBuild ? `
build:
  stage: build
  script:
    - ${pm === 'npm' ? 'npm run' : pm} build
  artifacts:
    paths:
      - dist/
      - .next/
    expire_in: 1 week
` : ''}
`;
}

// ============================================================================
// CI/CD Generator Class
// ============================================================================

export class CICDGenerator {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Generate GitHub Actions CI workflow
     */
    async generateCI(
        projectInfo: ProjectInfo,
        options: WorkflowOptions = {}
    ): Promise<string> {
        const content = generateGitHubActionsCI(projectInfo, options);
        const workflowDir = path.join(this.workspaceRoot, '.github', 'workflows');
        await fsPromises.mkdir(workflowDir, { recursive: true });
        await fsPromises.writeFile(path.join(workflowDir, 'ci.yml'), content);
        return `Created .github/workflows/ci.yml`;
    }

    /**
     * Generate Vercel deployment workflow
     */
    async generateVercelDeploy(branches?: string[]): Promise<string> {
        const content = generateGitHubActionsDeployVercel(branches);
        const workflowDir = path.join(this.workspaceRoot, '.github', 'workflows');
        await fsPromises.mkdir(workflowDir, { recursive: true });
        await fsPromises.writeFile(path.join(workflowDir, 'deploy-vercel.yml'), content);
        return `Created .github/workflows/deploy-vercel.yml\n\nRequired secrets:\n- VERCEL_TOKEN\n- VERCEL_ORG_ID\n- VERCEL_PROJECT_ID`;
    }

    /**
     * Generate Docker build and push workflow
     */
    async generateDockerDeploy(
        imageName: string,
        registry: 'ghcr' | 'dockerhub' = 'ghcr'
    ): Promise<string> {
        const content = generateGitHubActionsDeployDocker(imageName, registry);
        const workflowDir = path.join(this.workspaceRoot, '.github', 'workflows');
        await fsPromises.mkdir(workflowDir, { recursive: true });
        await fsPromises.writeFile(path.join(workflowDir, 'docker.yml'), content);
        
        const secretsInfo = registry === 'ghcr'
            ? 'Uses GITHUB_TOKEN (automatic)'
            : 'Required secrets:\n- DOCKERHUB_USERNAME\n- DOCKERHUB_TOKEN';
        
        return `Created .github/workflows/docker.yml\n\n${secretsInfo}`;
    }

    /**
     * Generate release workflow
     */
    async generateRelease(): Promise<string> {
        const content = generateGitHubActionsRelease();
        const workflowDir = path.join(this.workspaceRoot, '.github', 'workflows');
        await fsPromises.mkdir(workflowDir, { recursive: true });
        await fsPromises.writeFile(path.join(workflowDir, 'release.yml'), content);
        return `Created .github/workflows/release.yml\n\nTrigger: Push tags matching v*`;
    }

    /**
     * Generate Dependabot config
     */
    async generateDependabot(): Promise<string> {
        const content = generateDependabot();
        const githubDir = path.join(this.workspaceRoot, '.github');
        await fsPromises.mkdir(githubDir, { recursive: true });
        await fsPromises.writeFile(path.join(githubDir, 'dependabot.yml'), content);
        return `Created .github/dependabot.yml`;
    }

    /**
     * Generate GitLab CI config
     */
    async generateGitLabCI(
        projectInfo: ProjectInfo,
        options: WorkflowOptions = {}
    ): Promise<string> {
        const content = generateGitLabCI(projectInfo, options);
        await fsPromises.writeFile(
            path.join(this.workspaceRoot, '.gitlab-ci.yml'),
            content
        );
        return `Created .gitlab-ci.yml`;
    }

    /**
     * Generate all common CI/CD files
     */
    async generateAll(projectInfo: ProjectInfo): Promise<string> {
        const results: string[] = [];
        
        results.push(await this.generateCI(projectInfo));
        results.push(await this.generateDependabot());
        results.push(await this.generateRelease());
        
        return results.join('\n');
    }
}
