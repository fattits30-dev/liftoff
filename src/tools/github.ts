/**
 * GitHub Tools for Liftoff Agents
 * 
 * Comprehensive GitHub integration including:
 * - Repository management
 * - Issues and PRs
 * - GitHub Actions / CI/CD
 * - Branch management
 * - Releases
 */


// ============================================================================
// Types
// ============================================================================

export interface GitHubConfig {
    token?: string;
    owner?: string;
    repo?: string;
    baseUrl?: string; // For GitHub Enterprise
}

export interface Repository {
    owner: string;
    name: string;
    fullName: string;
    description: string;
    url: string;
    defaultBranch: string;
    isPrivate: boolean;
    stars: number;
    forks: number;
}

export interface Issue {
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    labels: string[];
    assignees: string[];
    author: string;
    createdAt: string;
    updatedAt: string;
}

export interface PullRequest extends Issue {
    head: string;
    base: string;
    merged: boolean;
    mergeable: boolean | null;
    draft: boolean;
}

export interface WorkflowRun {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    branch: string;
    event: string;
    createdAt: string;
    url: string;
}

export interface Release {
    id: number;
    tagName: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    createdAt: string;
    publishedAt: string;
    url: string;
}

// ============================================================================
// GitHub API Client
// ============================================================================

export class GitHubClient {
    private token: string;
    private baseUrl: string;
    private owner: string;
    private repo: string;

    constructor(config: GitHubConfig) {
        this.token = config.token || process.env.GITHUB_TOKEN || '';
        this.baseUrl = config.baseUrl || 'https://api.github.com';
        this.owner = config.owner || '';
        this.repo = config.repo || '';
    }

    private async fetch(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Liftoff-Agent',
            ...(options.headers as Record<string, string> || {})
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`GitHub API error (${response.status}): ${error}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
            return response.json();
        }
        return response.text();
    }

    setRepo(owner: string, repo: string): void {
        this.owner = owner;
        this.repo = repo;
    }

    // ========================================================================
    // Repository Operations
    // ========================================================================

    async getRepo(owner?: string, repo?: string): Promise<Repository> {
        const o = owner || this.owner;
        const r = repo || this.repo;
        const data = await this.fetch(`/repos/${o}/${r}`);
        
        return {
            owner: data.owner.login,
            name: data.name,
            fullName: data.full_name,
            description: data.description || '',
            url: data.html_url,
            defaultBranch: data.default_branch,
            isPrivate: data.private,
            stars: data.stargazers_count,
            forks: data.forks_count
        };
    }

    async listRepos(username?: string): Promise<Repository[]> {
        const endpoint = username 
            ? `/users/${username}/repos?sort=updated&per_page=30`
            : '/user/repos?sort=updated&per_page=30';
        
        const data = await this.fetch(endpoint);
        return data.map((repo: any) => ({
            owner: repo.owner.login,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description || '',
            url: repo.html_url,
            defaultBranch: repo.default_branch,
            isPrivate: repo.private,
            stars: repo.stargazers_count,
            forks: repo.forks_count
        }));
    }

    async createRepo(name: string, options: {
        description?: string;
        private?: boolean;
        autoInit?: boolean;
    } = {}): Promise<Repository> {
        const data = await this.fetch('/user/repos', {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: options.description || '',
                private: options.private || false,
                auto_init: options.autoInit || true
            })
        });

        return {
            owner: data.owner.login,
            name: data.name,
            fullName: data.full_name,
            description: data.description || '',
            url: data.html_url,
            defaultBranch: data.default_branch,
            isPrivate: data.private,
            stars: 0,
            forks: 0
        };
    }

    // ========================================================================
    // Issue Operations
    // ========================================================================

    async listIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
        const data = await this.fetch(
            `/repos/${this.owner}/${this.repo}/issues?state=${state}&per_page=30`
        );

        return data
            .filter((item: any) => !item.pull_request) // Exclude PRs
            .map((issue: any) => ({
                number: issue.number,
                title: issue.title,
                body: issue.body || '',
                state: issue.state,
                labels: issue.labels.map((l: any) => l.name),
                assignees: issue.assignees.map((a: any) => a.login),
                author: issue.user.login,
                createdAt: issue.created_at,
                updatedAt: issue.updated_at
            }));
    }

    async getIssue(number: number): Promise<Issue> {
        const issue = await this.fetch(
            `/repos/${this.owner}/${this.repo}/issues/${number}`
        );

        return {
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state,
            labels: issue.labels.map((l: any) => l.name),
            assignees: issue.assignees.map((a: any) => a.login),
            author: issue.user.login,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at
        };
    }

    async createIssue(title: string, body?: string, labels?: string[]): Promise<Issue> {
        const issue = await this.fetch(
            `/repos/${this.owner}/${this.repo}/issues`,
            {
                method: 'POST',
                body: JSON.stringify({ title, body, labels })
            }
        );

        return {
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state,
            labels: issue.labels.map((l: any) => l.name),
            assignees: [],
            author: issue.user.login,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at
        };
    }

    async updateIssue(number: number, updates: {
        title?: string;
        body?: string;
        state?: 'open' | 'closed';
        labels?: string[];
    }): Promise<Issue> {
        const issue = await this.fetch(
            `/repos/${this.owner}/${this.repo}/issues/${number}`,
            {
                method: 'PATCH',
                body: JSON.stringify(updates)
            }
        );

        return {
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state,
            labels: issue.labels.map((l: any) => l.name),
            assignees: issue.assignees.map((a: any) => a.login),
            author: issue.user.login,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at
        };
    }

    async addComment(issueNumber: number, body: string): Promise<{ id: number; body: string }> {
        const comment = await this.fetch(
            `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
            {
                method: 'POST',
                body: JSON.stringify({ body })
            }
        );

        return { id: comment.id, body: comment.body };
    }

    // ========================================================================
    // Pull Request Operations
    // ========================================================================

    async listPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
        const data = await this.fetch(
            `/repos/${this.owner}/${this.repo}/pulls?state=${state}&per_page=30`
        );

        return data.map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            body: pr.body || '',
            state: pr.state,
            labels: pr.labels.map((l: any) => l.name),
            assignees: pr.assignees.map((a: any) => a.login),
            author: pr.user.login,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            head: pr.head.ref,
            base: pr.base.ref,
            merged: pr.merged,
            mergeable: pr.mergeable,
            draft: pr.draft
        }));
    }

    async createPullRequest(title: string, head: string, base: string, body?: string): Promise<PullRequest> {
        const pr = await this.fetch(
            `/repos/${this.owner}/${this.repo}/pulls`,
            {
                method: 'POST',
                body: JSON.stringify({ title, head, base, body })
            }
        );

        return {
            number: pr.number,
            title: pr.title,
            body: pr.body || '',
            state: pr.state,
            labels: pr.labels.map((l: any) => l.name),
            assignees: [],
            author: pr.user.login,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            head: pr.head.ref,
            base: pr.base.ref,
            merged: false,
            mergeable: pr.mergeable,
            draft: pr.draft
        };
    }

    async mergePullRequest(number: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> {
        try {
            await this.fetch(
                `/repos/${this.owner}/${this.repo}/pulls/${number}/merge`,
                {
                    method: 'PUT',
                    body: JSON.stringify({ merge_method: method })
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // Branch Operations
    // ========================================================================

    async listBranches(): Promise<Array<{ name: string; protected: boolean }>> {
        const data = await this.fetch(
            `/repos/${this.owner}/${this.repo}/branches`
        );
        return data.map((b: any) => ({ name: b.name, protected: b.protected }));
    }

    async createBranch(name: string, fromBranch?: string): Promise<boolean> {
        try {
            // Get SHA of source branch
            const source = fromBranch || (await this.getRepo()).defaultBranch;
            const ref = await this.fetch(
                `/repos/${this.owner}/${this.repo}/git/refs/heads/${source}`
            );

            // Create new branch
            await this.fetch(
                `/repos/${this.owner}/${this.repo}/git/refs`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        ref: `refs/heads/${name}`,
                        sha: ref.object.sha
                    })
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    async deleteBranch(name: string): Promise<boolean> {
        try {
            await this.fetch(
                `/repos/${this.owner}/${this.repo}/git/refs/heads/${name}`,
                { method: 'DELETE' }
            );
            return true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // GitHub Actions
    // ========================================================================

    async listWorkflows(): Promise<Array<{ id: number; name: string; path: string }>> {
        const data = await this.fetch(
            `/repos/${this.owner}/${this.repo}/actions/workflows`
        );
        return data.workflows.map((w: any) => ({
            id: w.id,
            name: w.name,
            path: w.path
        }));
    }

    async listWorkflowRuns(workflowId?: number): Promise<WorkflowRun[]> {
        const endpoint = workflowId
            ? `/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/runs?per_page=10`
            : `/repos/${this.owner}/${this.repo}/actions/runs?per_page=10`;

        const data = await this.fetch(endpoint);
        return data.workflow_runs.map((run: any) => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            branch: run.head_branch,
            event: run.event,
            createdAt: run.created_at,
            url: run.html_url
        }));
    }

    async triggerWorkflow(workflowId: number | string, ref: string, inputs?: Record<string, string>): Promise<boolean> {
        try {
            await this.fetch(
                `/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/dispatches`,
                {
                    method: 'POST',
                    body: JSON.stringify({ ref, inputs: inputs || {} })
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    async getWorkflowRunLogs(runId: number): Promise<string> {
        try {
            // This returns a redirect to download URL
            const response = await fetch(
                `${this.baseUrl}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/logs`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    redirect: 'follow'
                }
            );
            return `Logs available at: ${response.url}`;
        } catch {
            return 'Could not fetch logs';
        }
    }

    // ========================================================================
    // Releases
    // ========================================================================

    async listReleases(): Promise<Release[]> {
        const data = await this.fetch(
            `/repos/${this.owner}/${this.repo}/releases?per_page=10`
        );

        return data.map((r: any) => ({
            id: r.id,
            tagName: r.tag_name,
            name: r.name || r.tag_name,
            body: r.body || '',
            draft: r.draft,
            prerelease: r.prerelease,
            createdAt: r.created_at,
            publishedAt: r.published_at,
            url: r.html_url
        }));
    }

    async createRelease(tagName: string, options: {
        name?: string;
        body?: string;
        draft?: boolean;
        prerelease?: boolean;
        targetCommitish?: string;
    } = {}): Promise<Release> {
        const release = await this.fetch(
            `/repos/${this.owner}/${this.repo}/releases`,
            {
                method: 'POST',
                body: JSON.stringify({
                    tag_name: tagName,
                    name: options.name || tagName,
                    body: options.body || '',
                    draft: options.draft || false,
                    prerelease: options.prerelease || false,
                    target_commitish: options.targetCommitish
                })
            }
        );

        return {
            id: release.id,
            tagName: release.tag_name,
            name: release.name,
            body: release.body || '',
            draft: release.draft,
            prerelease: release.prerelease,
            createdAt: release.created_at,
            publishedAt: release.published_at,
            url: release.html_url
        };
    }

    // ========================================================================
    // File Operations
    // ========================================================================

    async getFileContent(path: string, ref?: string): Promise<string> {
        const endpoint = ref
            ? `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${ref}`
            : `/repos/${this.owner}/${this.repo}/contents/${path}`;

        const data = await this.fetch(endpoint);
        
        if (data.type !== 'file') {
            throw new Error(`${path} is not a file`);
        }

        return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    async createOrUpdateFile(path: string, content: string, message: string, branch?: string): Promise<boolean> {
        try {
            // Check if file exists to get SHA
            let sha: string | undefined;
            try {
                const existing = await this.fetch(
                    `/repos/${this.owner}/${this.repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`
                );
                sha = existing.sha;
            } catch {
                // File doesn't exist
            }

            await this.fetch(
                `/repos/${this.owner}/${this.repo}/contents/${path}`,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        message,
                        content: Buffer.from(content).toString('base64'),
                        branch,
                        sha
                    })
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // Search
    // ========================================================================

    async searchCode(query: string): Promise<Array<{ path: string; repo: string; url: string }>> {
        const repoFilter = this.owner && this.repo ? `+repo:${this.owner}/${this.repo}` : '';
        const data = await this.fetch(
            `/search/code?q=${encodeURIComponent(query)}${repoFilter}&per_page=20`
        );

        return data.items.map((item: any) => ({
            path: item.path,
            repo: item.repository.full_name,
            url: item.html_url
        }));
    }

    async searchIssues(query: string): Promise<Issue[]> {
        const repoFilter = this.owner && this.repo ? `+repo:${this.owner}/${this.repo}` : '';
        const data = await this.fetch(
            `/search/issues?q=${encodeURIComponent(query)}${repoFilter}&per_page=20`
        );

        return data.items.map((issue: any) => ({
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state,
            labels: issue.labels.map((l: any) => l.name),
            assignees: issue.assignees?.map((a: any) => a.login) || [],
            author: issue.user.login,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at
        }));
    }
}
