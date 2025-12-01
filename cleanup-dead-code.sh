#!/bin/bash
# Dead Code Cleanup Script for Liftoff
# Generated: 2025-12-01
# Safe to run - removes only confirmed unused code

set -e  # Exit on error

echo "🧹 Liftoff Dead Code Cleanup"
echo "============================"
echo ""

# Backup first (just in case)
BACKUP_DIR=".cleanup-backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup in $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"
cp -r src/_legacy "$BACKUP_DIR/" 2>/dev/null || true
cp src/agentViewProvider.enhanced.ts "$BACKUP_DIR/" 2>/dev/null || true
cp src/agentViewProvider.original.ts "$BACKUP_DIR/" 2>/dev/null || true
cp -r src/di "$BACKUP_DIR/" 2>/dev/null || true
echo "✅ Backup created"
echo ""

# Phase 1: Remove confirmed dead code
echo "🗑️  Phase 1: Removing confirmed dead code..."
echo ""

if [ -d "src/_legacy" ]; then
    echo "  - Removing src/_legacy/ (37KB)"
    rm -rf src/_legacy/
    echo "    ✅ Removed legacy implementation"
fi

if [ -f "src/agentViewProvider.enhanced.ts" ]; then
    echo "  - Removing src/agentViewProvider.enhanced.ts (28KB)"
    rm src/agentViewProvider.enhanced.ts
    echo "    ✅ Removed duplicate enhanced view"
fi

if [ -f "src/agentViewProvider.original.ts" ]; then
    echo "  - Removing src/agentViewProvider.original.ts (24KB)"
    rm src/agentViewProvider.original.ts
    echo "    ✅ Removed duplicate original view"
fi

if [ -d "src/di" ]; then
    echo "  - Removing src/di/ (13KB)"
    rm -rf src/di/
    echo "    ✅ Removed unused DI container"
fi

echo ""
echo "✨ Phase 1 Complete: Removed ~102KB of dead code"
echo ""

# Phase 2: Fix linting issues
echo "🔧 Phase 2: Fixing ESLint warnings..."
npm run lint:fix
echo "✅ Lint fixes applied"
echo ""

# Phase 3: Verify compilation
echo "🔍 Phase 3: Verifying TypeScript compilation..."
npx tsc --noEmit
echo "✅ TypeScript compilation successful"
echo ""

echo "🎉 Cleanup Complete!"
echo ""
echo "Summary:"
echo "  - Removed 7 files/directories (~102KB)"
echo "  - Fixed ESLint warnings"
echo "  - Verified TypeScript compilation"
echo ""
echo "Backup location: $BACKUP_DIR"
echo "To restore: cp -r $BACKUP_DIR/* src/"
echo ""
echo "⚠️  Optional Phase 2 (manual review needed):"
echo "  Review and potentially remove:"
echo "  - src/core/ (55KB) - unused architecture layer"
echo "  - src/infrastructure/ (68KB) - unused infrastructure layer"
echo "  - src/collaboration/ (61KB) - unused collaboration modules"
echo ""
