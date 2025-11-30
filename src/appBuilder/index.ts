/**
 * App Builder Module - Exports all app builder components
 */

// Types
export * from './types';

// Core classes
export { SpecGenerator, saveSpec, loadSpec } from './specGenerator';
export { ArchitectureGenerator, generateArchitecture, generateMigrationSQL } from './architectureGenerator';
export { Scaffolder } from './scaffolder';
export { AppBuilderOrchestrator, BuildResult } from './appBuilderOrchestrator';

// Feature tasks
export {
    FEATURE_TASKS,
    getOrderedTasks,
    generateEntityTasks,
    getAppTypeTasks,
    TaskDefinition,
    FeatureTaskSet,
    AgentType
} from './featureTasks';

// State management
export {
    BuildStateManager,
    saveBuildState,
    loadBuildState,
    hasBuildState
} from './buildState';

// Liftoff plan management
export {
    LiftoffPlan,
    createInitialPlan,
    updatePhaseStatus,
    addFeature,
    updateFeatureStatus,
    canStartPhase,
    getOrchestratorInstructions,
    serializePlan,
    deserializePlan,
    BuildMode,
    PhaseStatus,
    PhaseDefinition,
    FeatureProgress,
    TaskProgress
} from './liftoffPlan';
