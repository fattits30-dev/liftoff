/**
 * .liftoff Planning File Format
 *
 * This file keeps the MainOrchestrator on track during app building.
 * It defines phases, tracks progress, and ensures proper delegation flow.
 */

export type BuildMode = 'app-builder' | 'code-editing';
export type PhaseStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'skipped';

export interface PhaseDefinition {
    name: string;
    status: PhaseStatus;
    dependencies: string[];
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
}

export interface FeatureProgress {
    name: string;
    status: PhaseStatus;
    tasks: TaskProgress[];
    agent?: string;
}

export interface TaskProgress {
    description: string;
    agent: string;
    status: PhaseStatus;
    attempts: number;
    error?: string;
}

export interface LiftoffPlan {
    // Meta
    version: string;
    mode: BuildMode;
    createdAt: Date;
    updatedAt: Date;

    // Project info
    description: string;
    targetDir: string;

    // Phase tracking
    currentPhase: string;
    phases: {
        spec: PhaseDefinition;
        architecture: PhaseDefinition;
        scaffold: PhaseDefinition;
        implement: PhaseDefinition;
        test: PhaseDefinition;
        deploy: PhaseDefinition;
    };

    // Implementation tracking
    features: FeatureProgress[];

    // Progress summary
    progress: {
        completedPhases: string[];
        blockers: string[];
        todoItems: string[];
    };

    // Generated artifacts
    artifacts: {
        specFile?: string;      // liftoff.spec.json
        archFile?: string;      // liftoff.architecture.json
        migrationFile?: string; // supabase/migrations/...sql
    };
}

/**
 * Create initial .liftoff plan from user description
 */
export function createInitialPlan(description: string, targetDir: string): LiftoffPlan {
    const now = new Date();

    return {
        version: '1.0.0',
        mode: 'app-builder',
        createdAt: now,
        updatedAt: now,

        description,
        targetDir,

        currentPhase: 'spec',
        phases: {
            spec: {
                name: 'Specification',
                status: 'pending',
                dependencies: []
            },
            architecture: {
                name: 'Architecture Design',
                status: 'pending',
                dependencies: ['spec']
            },
            scaffold: {
                name: 'Project Scaffolding',
                status: 'pending',
                dependencies: ['architecture']
            },
            implement: {
                name: 'Feature Implementation',
                status: 'pending',
                dependencies: ['scaffold']
            },
            test: {
                name: 'Testing',
                status: 'pending',
                dependencies: ['implement']
            },
            deploy: {
                name: 'Deployment',
                status: 'pending',
                dependencies: ['test']
            }
        },

        features: [],

        progress: {
            completedPhases: [],
            blockers: [],
            todoItems: []
        },

        artifacts: {}
    };
}

/**
 * Update phase status and move to next phase if complete
 */
export function updatePhaseStatus(
    plan: LiftoffPlan,
    phase: keyof LiftoffPlan['phases'],
    status: PhaseStatus,
    error?: string
): LiftoffPlan {
    const updated = { ...plan };
    updated.phases[phase].status = status;
    updated.updatedAt = new Date();

    if (status === 'in-progress' && !updated.phases[phase].startedAt) {
        updated.phases[phase].startedAt = new Date();
    }

    if (status === 'complete') {
        updated.phases[phase].completedAt = new Date();
        updated.progress.completedPhases.push(phase);

        // Move to next phase
        const phaseOrder: (keyof LiftoffPlan['phases'])[] = [
            'spec', 'architecture', 'scaffold', 'implement', 'test', 'deploy'
        ];
        const currentIndex = phaseOrder.indexOf(phase);
        if (currentIndex < phaseOrder.length - 1) {
            updated.currentPhase = phaseOrder[currentIndex + 1];
            updated.phases[phaseOrder[currentIndex + 1]].status = 'pending';
        }
    }

    if (status === 'failed') {
        updated.phases[phase].error = error;
        updated.progress.blockers.push(`Phase ${phase} failed: ${error}`);
    }

    return updated;
}

/**
 * Add feature to implementation tracking
 */
export function addFeature(
    plan: LiftoffPlan,
    name: string,
    tasks: TaskProgress[]
): LiftoffPlan {
    const updated = { ...plan };
    updated.features.push({
        name,
        status: 'pending',
        tasks
    });
    updated.updatedAt = new Date();
    return updated;
}

/**
 * Update feature status
 */
export function updateFeatureStatus(
    plan: LiftoffPlan,
    featureName: string,
    status: PhaseStatus,
    error?: string
): LiftoffPlan {
    const updated = { ...plan };
    const feature = updated.features.find(f => f.name === featureName);
    if (feature) {
        feature.status = status;
        if (error) {
            updated.progress.blockers.push(`Feature ${featureName} failed: ${error}`);
        }
    }
    updated.updatedAt = new Date();
    return updated;
}

/**
 * Check if phase can start (all dependencies complete)
 */
export function canStartPhase(
    plan: LiftoffPlan,
    phase: keyof LiftoffPlan['phases']
): boolean {
    const phaseConfig = plan.phases[phase];
    return phaseConfig.dependencies.every(dep =>
        plan.progress.completedPhases.includes(dep)
    );
}

/**
 * Get orchestrator instructions based on current phase
 */
export function getOrchestratorInstructions(plan: LiftoffPlan): string {
    const phase = plan.currentPhase as keyof LiftoffPlan['phases'];
    const phaseConfig = plan.phases[phase];

    if (phaseConfig.status === 'complete') {
        return `Phase ${phase} is complete. Moving to next phase.`;
    }

    const instructions: Record<string, string> = {
        spec: `
🎯 CURRENT PHASE: SPECIFICATION
Your task: Generate AppSpec from user description

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runSpecPhase()
2. This will:
   - Parse the description
   - Ask clarifying questions via VS Code UI
   - Generate structured AppSpec JSON
   - Save to ${plan.artifacts.specFile || 'liftoff.spec.json'}

DO NOT:
- Manually create files
- Delegate to agents yet
- Write any code

NEXT PHASE: Architecture (after spec is complete)
        `,

        architecture: `
🎯 CURRENT PHASE: ARCHITECTURE
Your task: Design system architecture from spec

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runArchitecturePhase()
2. This will:
   - Generate database schema from entities
   - Plan component tree
   - Define API routes
   - Map file structure
   - Save to ${plan.artifacts.archFile || 'liftoff.architecture.json'}

DO NOT:
- Manually create files
- Delegate to agents yet
- Write any code

NEXT PHASE: Scaffold (after architecture is complete)
        `,

        scaffold: `
🎯 CURRENT PHASE: SCAFFOLD
Your task: Create project structure from templates

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runScaffoldPhase()
2. This will:
   - Copy base template to target directory
   - Generate folder structure
   - Create Supabase migration SQL
   - Set up environment files
   - Run npm install

DO NOT:
- Manually create files
- Delegate to agents yet

NEXT PHASE: Implementation (after scaffold is complete)
        `,

        implement: `
🎯 CURRENT PHASE: IMPLEMENTATION
Your task: Build features using agent delegation

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runImplementationPhase()
2. For each feature in the plan:
   - Get ordered tasks from featureTasks.ts
   - Delegate each task to appropriate agent
   - Wait for completion
   - Track progress in .liftoff file
   - If task fails 3 times, add to TODO and continue

FEATURES TO IMPLEMENT:
${plan.features.map(f => `- ${f.name} (${f.status})`).join('\n')}

NOW you can delegate to agents! Follow the task definitions.

NEXT PHASE: Testing (after all features complete)
        `,

        test: `
🎯 CURRENT PHASE: TESTING
Your task: Run test suite and fix failures

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runTestPhase()
2. Delegate to testing agent:
   - Run full test suite
   - Report failures
   - Fix issues
   - Re-run until passing

NEXT PHASE: Deploy (after tests pass)
        `,

        deploy: `
🎯 CURRENT PHASE: DEPLOYMENT
Your task: Deploy to hosting

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runDeployPhase()
2. This will:
   - Build production bundle
   - Push to git
   - Deploy to Vercel/Netlify
   - Return deployment URL

FINAL STEP: Report completion to user
        `
    };

    return instructions[phase] || 'Unknown phase';
}

/**
 * Save plan to file
 */
export function serializePlan(plan: LiftoffPlan): string {
    return JSON.stringify(plan, null, 2);
}

/**
 * Load plan from file
 */
export function deserializePlan(content: string): LiftoffPlan {
    const parsed = JSON.parse(content);
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    Object.values(parsed.phases).forEach((phase: any) => {
        if (phase.startedAt) phase.startedAt = new Date(phase.startedAt);
        if (phase.completedAt) phase.completedAt = new Date(phase.completedAt);
    });
    return parsed;
}
