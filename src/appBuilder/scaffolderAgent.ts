/**
 * Scaffolder Agent - Generates CUSTOM business logic only (TIER 3)
 *
 * This agent generates entity-specific pages, custom hooks, and layouts.
 * Boilerplate configs are handled by official CLIs (TIER 1) and templates (TIER 2).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { MainOrchestrator } from '../mainOrchestrator';
import { AppSpec, Architecture } from './types';

export class ScaffolderAgent {
    constructor(
        private orchestrator: MainOrchestrator,
        private targetDir: string,
        private extensionPath: string
    ) {}

    /**
     * Generate custom business logic (TIER 3)
     *
     * Official CLIs already created:
     * - package.json, vite.config.ts, tsconfig.json (TIER 1)
     * - Base UI components via shadcn/ui (TIER 1)
     * - Supabase client, auth hook (TIER 2)
     *
     * This method generates ONLY:
     * - Entity-specific pages (RecipeList, RecipeForm, etc.)
     * - Custom layouts
     */
    async generateCustomFeatures(spec: AppSpec, architecture: Architecture): Promise<void> {
        // Ensure directory structure exists
        await this.createDirectoryStructure(spec);

        // Generate entity-specific pages
        await this.generateEntityPages(spec, architecture);

        // Generate layout components
        await this.generateLayouts(spec);

        console.log(`✓ Custom features generated with AI`);
    }

    /**
     * Create directory structure (ensure pages dir exists)
     */
    private async createDirectoryStructure(_spec: AppSpec): Promise<void> {
        const dirs = [
            'src/pages',
            'src/layouts'
        ];

        for (const dir of dirs) {
            await fs.mkdir(path.join(this.targetDir, dir), { recursive: true });
        }
    }

    /**
     * Generate entity-specific pages (list, form, detail)
     */
    private async generateEntityPages(spec: AppSpec, architecture: Architecture): Promise<void> {
        for (const table of architecture.database.tables) {
            // Skip system tables
            if (table.name === 'profiles' || table.name === 'users') continue;

            const entityName = this.toPascalCase(table.name);

            // Generate list page
            await this.generateEntityListPage(table, spec, entityName);

            // Generate form page (create/edit)
            await this.generateEntityFormPage(table, spec, entityName);
        }
    }

    /**
     * Generate entity list page
     */
    private async generateEntityListPage(table: any, spec: AppSpec, entityName: string): Promise<void> {
        const prompt = `Generate a ${entityName} list page component.

**Project Context:**
- Framework: ${spec.stack.frontend}
- Styling: ${spec.stack.styling}
- Backend: ${spec.stack.backend}

**Entity Schema:**
Table: ${table.name}
Columns: ${table.columns.map((c: any) => `${c.name}: ${c.type}`).join(', ')}

**Requirements:**
1. Fetch data from Supabase table "${table.name}"
2. Display in a table with search and pagination
3. Use shadcn/ui Table component (already installed via CLI)
4. Use Tailwind for styling (already configured via CLI)
5. Include "Add New" button linking to form page

**Code Pattern:**
\`\`\`tsx
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Link } from 'react-router-dom';

export function ${entityName}ListPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase.from('${table.name}').select('*');
      if (data) setItems(data);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">${entityName}s</h1>
        <Link to="/${table.name}/new">
          <Button>Add New</Button>
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {/* Add table headers */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              {/* Render item cells */}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
\`\`\`

Output ONLY the complete component code.`;

        const result = await this.orchestrator.delegateTask('frontend', prompt);
        const content = this.extractCodeBlock(result.message || '');

        await fs.writeFile(
            path.join(this.targetDir, `src/pages/${entityName}ListPage.tsx`),
            content,
            'utf-8'
        );
    }

    /**
     * Generate entity form page (create/edit)
     */
    private async generateEntityFormPage(table: any, spec: AppSpec, entityName: string): Promise<void> {
        const prompt = `Generate a ${entityName} form page component for creating and editing.

**Project Context:**
- Framework: ${spec.stack.frontend}
- Styling: ${spec.stack.styling}
- Backend: ${spec.stack.backend}

**Entity Schema:**
Table: ${table.name}
Columns: ${table.columns.map((c: any) => `${c.name}: ${c.type}`).join(', ')}

**Requirements:**
1. Form for creating/editing ${table.name} records
2. Use shadcn/ui Form, Input, Button components (already installed)
3. Use Tailwind for styling
4. Handle both create (no ID in URL) and edit (ID in URL) modes
5. Navigate back to list page after save

**Code Pattern:**
\`\`\`tsx
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export function ${entityName}FormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    // Initialize form fields
  });

  useEffect(() => {
    if (id) {
      // Fetch existing record
      async function fetchData() {
        const { data } = await supabase.from('${table.name}').select('*').eq('id', id).single();
        if (data) setFormData(data);
      }
      fetchData();
    }
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (id) {
      // Update
      await supabase.from('${table.name}').update(formData).eq('id', id);
    } else {
      // Create
      await supabase.from('${table.name}').insert([formData]);
    }

    navigate('/${table.name}');
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>{id ? 'Edit' : 'Create'} ${entityName}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Render form fields */}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>Save</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/${table.name}')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
\`\`\`

Output ONLY the complete component code.`;

        const result = await this.orchestrator.delegateTask('frontend', prompt);
        const content = this.extractCodeBlock(result.message || '');

        await fs.writeFile(
            path.join(this.targetDir, `src/pages/${entityName}FormPage.tsx`),
            content,
            'utf-8'
        );
    }

    /**
     * Convert to PascalCase
     */
    private toPascalCase(str: string): string {
        return str.split(/[-_]/).map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join('');
    }

    /**
     * REMOVED METHODS - Now handled by official CLIs and templates:
     *
     * - generatePackageJson() → Vite CLI creates this (TIER 1)
     * - generateGitignore() → Vite CLI creates this (TIER 1)
     * - generateTsConfig() → Vite CLI creates this (TIER 1)
     * - generateEnvTemplate() → Template overlay creates this (TIER 2)
     * - generateBundlerConfig() → Vite CLI creates vite.config.ts (TIER 1)
     * - generateMainEntry() → Vite CLI creates main.tsx (TIER 1)
     * - generateAppComponent() → Vite CLI creates App.tsx (TIER 1)
     * - generateSupabaseClient() → Template overlay creates this (TIER 2)
     * - generateAuthHook() → Template overlay creates this (TIER 2)
     * - generateBaseComponents() → shadcn/ui CLI creates these (TIER 1)
     * - generateTailwindConfig() → Tailwind CLI creates this (TIER 1)
     * - generateIndexCSS() → Can be template (TIER 2)
     * - generateUIComponent() → shadcn/ui CLI creates these (TIER 1)
     */

    /**
     * Generate layout components
     */
    private async generateLayouts(spec: AppSpec): Promise<void> {
        const layouts = ['default', 'auth', 'dashboard'];

        for (const layout of layouts) {
            const prompt = `Generate a ${layout} layout component (src/layouts/${layout}Layout.tsx).

Framework: ${spec.stack.frontend}
Styling: ${spec.stack.styling}

Requirements:
1. Accept children prop
2. Include navigation for ${layout} layout
3. ${spec.stack.styling === 'tailwind' ? 'Use Tailwind classes' : ''}
4. Responsive design

Output ONLY the file content, no explanations.`;

            const result = await this.orchestrator.delegateTask('frontend', prompt);
            const content = this.extractCodeBlock(result.message || '');
            await fs.writeFile(
                path.join(this.targetDir, `src/layouts/${layout}Layout.tsx`),
                content,
                'utf-8'
            );
        }
    }

    /**
     * Extract code from markdown code blocks
     */
    private extractCodeBlock(text: string): string {
        // Match ```tsx, ```typescript, ```ts, ```javascript, etc.
        const codeBlockMatch = text.match(/```(?:tsx?|typescript|javascript|jsx?)\n([\s\S]*?)```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1].trim();
        }

        // Fallback: if no code block, return as-is (agent might have outputted raw code)
        return text.trim();
    }
}
