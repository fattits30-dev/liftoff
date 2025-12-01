#!/usr/bin/env python3
"""
Import Checker for TypeScript projects
Scans all .ts files and reports:
- Unused imports
- Potentially missing imports
- Duplicate imports
"""

import os
import re
import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set, Tuple

class ImportChecker:
    def __init__(self, root_dir: str):
        self.root_dir = Path(root_dir)
        self.results = {
            'unused_imports': [],
            'duplicate_imports': [],
            'missing_imports': [],
            'stats': {}
        }

    def scan_directory(self, exclude_patterns: List[str] = None) -> None:
        """Scan all TypeScript files in directory"""
        if exclude_patterns is None:
            exclude_patterns = ['node_modules', 'dist', 'out', '.git', 'coverage']

        ts_files = []
        for pattern in ['**/*.ts', '**/*.tsx']:
            for file_path in self.root_dir.glob(pattern):
                # Skip excluded directories
                if any(excl in str(file_path) for excl in exclude_patterns):
                    continue
                ts_files.append(file_path)

        print(f"[*] Scanning {len(ts_files)} TypeScript files...")

        total_unused = 0
        total_duplicates = 0

        for file_path in ts_files:
            unused, duplicates = self.check_file(file_path)
            total_unused += len(unused)
            total_duplicates += len(duplicates)

        self.results['stats'] = {
            'total_files': len(ts_files),
            'files_with_unused': len([r for r in self.results['unused_imports'] if r['unused']]),
            'files_with_duplicates': len(self.results['duplicate_imports']),
            'total_unused_imports': total_unused,
            'total_duplicate_imports': total_duplicates
        }

    def check_file(self, file_path: Path) -> Tuple[List[str], List[str]]:
        """Check imports in a single file"""
        try:
            content = file_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"[!] Could not read {file_path}: {e}")
            return [], []

        # Extract imports
        imports = self.extract_imports(content)

        # Check for unused imports
        unused = self.find_unused_imports(content, imports)

        # Check for duplicate imports
        duplicates = self.find_duplicate_imports(imports)

        if unused:
            self.results['unused_imports'].append({
                'file': str(file_path.relative_to(self.root_dir)),
                'unused': unused
            })

        if duplicates:
            self.results['duplicate_imports'].append({
                'file': str(file_path.relative_to(self.root_dir)),
                'duplicates': duplicates
            })

        return unused, duplicates

    def extract_imports(self, content: str) -> Dict[str, List[str]]:
        """Extract all imports from file content"""
        imports = defaultdict(list)

        # Match: import { A, B } from 'module'
        named_pattern = r"import\s*\{\s*([^}]+)\s*\}\s*from\s*['\"]([^'\"]+)['\"]"
        for match in re.finditer(named_pattern, content):
            imported_items = match.group(1)
            module = match.group(2)
            # Split by comma and clean up
            items = [item.strip().split(' as ')[0].strip() for item in imported_items.split(',')]
            imports[module].extend(items)

        # Match: import * as X from 'module'
        namespace_pattern = r"import\s*\*\s*as\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]"
        for match in re.finditer(namespace_pattern, content):
            namespace = match.group(1)
            module = match.group(2)
            imports[module].append(f"* as {namespace}")

        # Match: import X from 'module' (default import)
        default_pattern = r"import\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]"
        for match in re.finditer(default_pattern, content):
            default_import = match.group(1)
            module = match.group(2)
            imports[module].append(default_import)

        # Match: import 'module' (side-effect import)
        side_effect_pattern = r"import\s+['\"]([^'\"]+)['\"]"
        for match in re.finditer(side_effect_pattern, content):
            module = match.group(1)
            imports[module].append('__side_effect__')

        return dict(imports)

    def find_unused_imports(self, content: str, imports: Dict[str, List[str]]) -> List[str]:
        """Find imports that are never used in the file"""
        unused = []

        # Remove import statements from content to check usage
        content_without_imports = re.sub(r'import\s+.*?from\s+[\'"][^\'"]+[\'"];?', '', content)
        content_without_imports = re.sub(r'import\s+[\'"][^\'"]+[\'"];?', '', content_without_imports)

        for module, items in imports.items():
            for item in items:
                # Skip side-effect imports
                if item == '__side_effect__':
                    continue

                # For namespace imports (import * as X)
                if item.startswith('* as '):
                    namespace = item.split('* as ')[1]
                    # Check if namespace is used
                    if not re.search(rf'\b{re.escape(namespace)}\b', content_without_imports):
                        unused.append(f"{item} from '{module}'")
                else:
                    # For named/default imports, check if used
                    # Use word boundary to avoid false positives
                    if not re.search(rf'\b{re.escape(item)}\b', content_without_imports):
                        unused.append(f"{item} from '{module}'")

        return unused

    def find_duplicate_imports(self, imports: Dict[str, List[str]]) -> List[str]:
        """Find duplicate imports from same module"""
        duplicates = []

        for module, items in imports.items():
            # Check for duplicate items
            seen = set()
            for item in items:
                if item in seen and item != '__side_effect__':
                    duplicates.append(f"{item} from '{module}'")
                seen.add(item)

        return duplicates

    def print_report(self) -> None:
        """Print formatted report"""
        stats = self.results['stats']

        print("\n" + "="*60)
        print("IMPORT CHECK REPORT")
        print("="*60)

        print(f"\nStatistics:")
        print(f"  Total files scanned: {stats['total_files']}")
        print(f"  Files with unused imports: {stats['files_with_unused']}")
        print(f"  Files with duplicate imports: {stats['files_with_duplicates']}")
        print(f"  Total unused imports: {stats['total_unused_imports']}")
        print(f"  Total duplicate imports: {stats['total_duplicate_imports']}")

        # Unused imports
        if self.results['unused_imports']:
            print(f"\n{'='*60}")
            print("UNUSED IMPORTS")
            print("="*60)
            for entry in self.results['unused_imports']:
                print(f"\n[FILE] {entry['file']}")
                for unused in entry['unused']:
                    print(f"  [X] {unused}")
        else:
            print("\n[OK] No unused imports found!")

        # Duplicate imports
        if self.results['duplicate_imports']:
            print(f"\n{'='*60}")
            print("DUPLICATE IMPORTS")
            print("="*60)
            for entry in self.results['duplicate_imports']:
                print(f"\n[FILE] {entry['file']}")
                for duplicate in entry['duplicates']:
                    print(f"  [DUP] {duplicate}")
        else:
            print("\n[OK] No duplicate imports found!")

        print("\n" + "="*60)

        # Save to JSON
        output_file = self.root_dir / 'import-check-report.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.results, f, indent=2)
        print(f"\n[SAVED] Detailed report saved to: {output_file.name}")

    def generate_fix_script(self) -> None:
        """Generate a script to auto-fix unused imports"""
        if not self.results['unused_imports']:
            return

        fix_script = []
        fix_script.append("#!/bin/bash")
        fix_script.append("# Auto-generated script to remove unused imports")
        fix_script.append("# Review before running!\n")

        for entry in self.results['unused_imports']:
            file_path = entry['file']
            fix_script.append(f"# Fix {file_path}")
            for unused in entry['unused']:
                # Extract the import name
                import_name = unused.split(' from ')[0]
                fix_script.append(f"# Remove: {unused}")
            fix_script.append("")

        script_path = self.root_dir / 'fix-unused-imports.sh'
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(fix_script))

        print(f"\n[SCRIPT] Fix script template saved to: {script_path.name}")
        print("         (Review and customize before running)")


def main():
    import sys

    # Get root directory from args or use current directory
    root_dir = sys.argv[1] if len(sys.argv) > 1 else '.'

    print("TypeScript Import Checker")
    print(f"Root directory: {os.path.abspath(root_dir)}\n")

    checker = ImportChecker(root_dir)
    checker.scan_directory()
    checker.print_report()
    checker.generate_fix_script()

    # Exit with error code if issues found
    if checker.results['stats']['total_unused_imports'] > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
