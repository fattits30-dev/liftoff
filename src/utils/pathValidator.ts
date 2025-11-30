import * as path from 'path';
import * as fs from 'fs';

const PROTECTED_PATTERNS = [
  /\.ssh/i, /\.aws/i, /\.env$/, /id_rsa/, /id_ed25519/,
  /System32/i, /Windows/i, /etc\/passwd/, /\.kube/,
  /\.npmrc/, /\.pypirc/, /credentials\.json/,
  /\.docker\/config\.json/, /NTUSER\.DAT/
];

/**
 * Validates that a path is safe to access:
 * 1. Must be within workspace root (prevents directory traversal)
 * 2. Must not match protected system/credential patterns
 *
 * @param requestedPath - Path to validate
 * @param workspaceRoot - Workspace root directory
 * @throws Error if path is unsafe
 */
export function validatePath(requestedPath: string, workspaceRoot: string): void {
  try {
    // Resolve to canonical path (prevents symlink/.. attacks)
    const resolved = fs.realpathSync.native(requestedPath);
    const rootResolved = fs.realpathSync.native(workspaceRoot);

    // Must be within workspace
    if (!resolved.startsWith(rootResolved)) {
      throw new Error(`Access denied: Path outside workspace (${resolved})`);
    }

    // Check against protected patterns
    for (const pattern of PROTECTED_PATTERNS) {
      if (pattern.test(resolved)) {
        throw new Error(`Access denied: Protected path (${resolved})`);
      }
    }
  } catch (err: any) {
    if (err.message.includes('Access denied')) {
      throw err;
    }
    // Path doesn't exist yet - validate parent directory exists within workspace
    const parentDir = path.dirname(requestedPath);
    if (fs.existsSync(parentDir)) {
      validatePath(parentDir, workspaceRoot);
    }
  }
}
