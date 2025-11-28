// Security configuration for file system access
import * as path from 'path';

// Files/directories agents should NEVER write to
export const DENY_WRITE: string[] = [
    '.env',
    '.env.*',
    '.env.local',
    '.env.production',
    '.git/**',
    '.git',
    'node_modules/**',
    'node_modules',
    '.venv/**',
    '.venv',
    '__pycache__/**',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    'id_rsa',
    'id_ed25519',
    '.ssh/**',
    'secrets/**',
    '.secrets/**',
    'credentials.json',
    'service-account*.json',
    '*.sqlite',
    '*.db',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
];

// Files agents should NEVER read (contains secrets)
export const DENY_READ: string[] = [
    '.env',
    '.env.*',
    '.env.local',
    '.env.production',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    'id_rsa',
    'id_ed25519',
    '.ssh/**',
    'secrets/**',
    '.secrets/**',
    'credentials.json',
    'service-account*.json',
];

// Match a path against glob patterns
function matchesPattern(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    
    // Handle ** (any directory depth)
    if (normalizedPattern.includes('**')) {
        const regex = new RegExp(
            '^' + normalizedPattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*') + '$'
        );
        return regex.test(normalizedPath);
    }
    
    // Handle * (single segment wildcard)
    if (normalizedPattern.includes('*')) {
        const regex = new RegExp(
            '^' + normalizedPattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '[^/]*') + '$'
        );
        return regex.test(normalizedPath);
    }
    
    // Handle .env.* style patterns
    if (normalizedPattern.endsWith('.*')) {
        const base = normalizedPattern.slice(0, -2);
        return normalizedPath === base || normalizedPath.startsWith(base + '.');
    }
    
    // Exact match or directory match
    return normalizedPath === normalizedPattern || 
           normalizedPath.startsWith(normalizedPattern + '/');
}

export function canWrite(filePath: string, workspaceRoot: string): { allowed: boolean; reason?: string } {
    const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const fileName = path.basename(filePath);
    
    for (const pattern of DENY_WRITE) {
        if (matchesPattern(relativePath, pattern) || matchesPattern(fileName, pattern)) {
            return { 
                allowed: false, 
                reason: `Protected path: ${pattern} - This file is protected for security reasons` 
            };
        }
    }
    
    return { allowed: true };
}

export function canRead(filePath: string, workspaceRoot: string): { allowed: boolean; reason?: string } {
    const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const fileName = path.basename(filePath);
    
    for (const pattern of DENY_READ) {
        if (matchesPattern(relativePath, pattern) || matchesPattern(fileName, pattern)) {
            return { 
                allowed: false, 
                reason: `Protected path: ${pattern} - This file contains sensitive data` 
            };
        }
    }
    
    return { allowed: true };
}

// Check if path is within workspace (prevent directory traversal)
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(workspaceRoot, filePath);
    const relative = path.relative(workspaceRoot, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}
