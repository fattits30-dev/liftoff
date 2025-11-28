// Lessons learned system - agents remember fixes that worked
import * as fs from 'fs';
import * as path from 'path';

export interface Lesson {
    id: string;
    errorPattern: string;      // The error message or pattern
    errorContext: string;      // What command/file caused it
    fix: string;               // What fixed it (tool + params)
    fixDescription: string;    // Human readable description
    successCount: number;      // How many times this fix worked
    createdAt: string;
    lastUsed: string;
    tags: string[];            // For categorization (npm, python, git, etc.)
}

export interface LessonsDB {
    version: number;
    lessons: Lesson[];
}

const LESSONS_FILE = '.liftoff/lessons.json';
const MAX_LESSONS = 200;

export class LessonsManager {
    private db: LessonsDB;
    private workspaceRoot: string;
    private filePath: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.filePath = path.join(workspaceRoot, LESSONS_FILE);
        this.db = this.load();
    }

    private load(): LessonsDB {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load lessons:', e);
        }
        return { version: 1, lessons: [] };
    }

    private save(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2));
        } catch (e) {
            console.error('Failed to save lessons:', e);
        }
    }

    // Find lessons that match an error
    public findRelevant(errorOutput: string, limit: number = 3): Lesson[] {
        const errorLower = errorOutput.toLowerCase();
        const words = this.extractKeywords(errorOutput);
        
        const scored = this.db.lessons.map(lesson => {
            let score = 0;
            
            // Exact pattern match (high score)
            if (errorLower.includes(lesson.errorPattern.toLowerCase())) {
                score += 100;
            }
            
            // Keyword overlap
            const lessonWords = this.extractKeywords(lesson.errorPattern + ' ' + lesson.errorContext);
            const overlap = words.filter(w => lessonWords.includes(w)).length;
            score += overlap * 10;
            
            // Boost by success count (proven fixes)
            score += Math.min(lesson.successCount * 2, 20);
            
            // Recency boost
            const daysSinceUse = (Date.now() - new Date(lesson.lastUsed).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceUse < 7) score += 10;
            else if (daysSinceUse < 30) score += 5;
            
            return { lesson, score };
        });

        return scored
            .filter(s => s.score > 20)  // Minimum relevance threshold
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.lesson);
    }

    // Record a successful fix
    public recordFix(
        errorPattern: string,
        errorContext: string,
        fix: string,
        fixDescription: string,
        tags: string[] = []
    ): Lesson {
        // Check if similar lesson exists
        const existing = this.db.lessons.find(l => 
            l.errorPattern.toLowerCase() === errorPattern.toLowerCase() &&
            l.fix.toLowerCase() === fix.toLowerCase()
        );

        if (existing) {
            existing.successCount++;
            existing.lastUsed = new Date().toISOString();
            this.save();
            return existing;
        }

        // Create new lesson
        const lesson: Lesson = {
            id: this.generateId(),
            errorPattern: this.cleanError(errorPattern),
            errorContext,
            fix,
            fixDescription,
            successCount: 1,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            tags: this.autoTag(errorPattern, fix, tags)
        };

        this.db.lessons.unshift(lesson);
        
        // Trim old lessons if over limit
        if (this.db.lessons.length > MAX_LESSONS) {
            // Remove least used lessons
            this.db.lessons.sort((a, b) => b.successCount - a.successCount);
            this.db.lessons = this.db.lessons.slice(0, MAX_LESSONS);
        }

        this.save();
        return lesson;
    }

    // Mark a lesson as used successfully
    public markUsed(lessonId: string): void {
        const lesson = this.db.lessons.find(l => l.id === lessonId);
        if (lesson) {
            lesson.successCount++;
            lesson.lastUsed = new Date().toISOString();
            this.save();
        }
    }

    // Get all lessons (for viewing)
    public getAll(): Lesson[] {
        return [...this.db.lessons];
    }

    // Delete a lesson
    public delete(lessonId: string): boolean {
        const idx = this.db.lessons.findIndex(l => l.id === lessonId);
        if (idx >= 0) {
            this.db.lessons.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    // Format lessons for injection into agent prompt
    public formatForPrompt(lessons: Lesson[]): string {
        if (lessons.length === 0) return '';
        
        return '\n\n## 💡 RELEVANT FIXES FROM PAST EXPERIENCE:\n' +
            lessons.map((l, i) => 
                `${i + 1}. Error: "${l.errorPattern}"\n` +
                `   Fix: ${l.fixDescription}\n` +
                `   Command: ${l.fix}\n` +
                `   (Worked ${l.successCount} time${l.successCount > 1 ? 's' : ''})`
            ).join('\n\n');
    }

    private extractKeywords(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2)
            .filter(w => !['the', 'and', 'for', 'error', 'failed', 'cannot', 'could', 'not'].includes(w));
    }

    private cleanError(error: string): string {
        // Remove file paths, line numbers, timestamps - keep the core error
        return error
            .replace(/\/[\w\/.-]+/g, '<path>')        // Unix paths
            .replace(/[A-Z]:\\[\w\\.-]+/gi, '<path>') // Windows paths
            .replace(/:\d+:\d+/g, '')                  // Line:col numbers
            .replace(/\d{4}-\d{2}-\d{2}/g, '')        // Dates
            .substring(0, 200)                         // Limit length
            .trim();
    }

    private autoTag(error: string, fix: string, userTags: string[]): string[] {
        const tags = new Set(userTags);
        const combined = (error + ' ' + fix).toLowerCase();
        
        if (combined.includes('npm') || combined.includes('node_modules')) tags.add('npm');
        if (combined.includes('pip') || combined.includes('python')) tags.add('python');
        if (combined.includes('git')) tags.add('git');
        if (combined.includes('typescript') || combined.includes('tsc')) tags.add('typescript');
        if (combined.includes('eslint') || combined.includes('lint')) tags.add('lint');
        if (combined.includes('test') || combined.includes('jest') || combined.includes('vitest')) tags.add('testing');
        if (combined.includes('import') || combined.includes('module')) tags.add('modules');
        if (combined.includes('permission') || combined.includes('access')) tags.add('permissions');
        
        return [...tags];
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }
}
