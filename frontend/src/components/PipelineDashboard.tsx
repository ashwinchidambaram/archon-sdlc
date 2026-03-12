import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/usePolling";
import type { StageResult } from "@/types";
import { StageName, StageStatus, ReviewVerdict, ProjectStatus } from "@/types";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ArrowRight,
  RotateCcw,
  FileText,
  Code,
  TestTube,
  Shield,
  Search,
  BookOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineDashboardProps {
  projectId: string;
  onViewArtifacts: () => void;
}

interface StageInfo {
  stage: StageName;
  iteration: number;
}

interface ResolvedStage {
  name: StageName;
  latestResult: StageResult | null;
  maxIteration: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse stage name and iteration from an s3_key when the StageResult fields
 * themselves are absent. Format: {project_id}/{stage}/iter{N}/...
 */
function parseStageInfoFromS3Key(s3Key: string | null | undefined): StageInfo | null {
  if (!s3Key) return null;
  const parts = s3Key.split("/");
  const stage = parts[1] as StageName | undefined;
  const iterPart = parts[2] ?? "iter0";
  const iteration = parseInt(iterPart.replace("iter", ""), 10) || 0;
  if (!stage) return null;
  return { stage, iteration };
}

/**
 * Resolve the stage name and iteration from a StageResult, falling back to
 * s3_key parsing when the typed fields are missing (back-compat with older API
 * responses that strip sk without writing explicit fields).
 */
function resolveStageInfo(result: StageResult): StageInfo | null {
  if (result.stage) {
    return { stage: result.stage, iteration: result.iteration ?? 0 };
  }
  return parseStageInfoFromS3Key(result.s3_key);
}

/**
 * Group a flat stages array by stage name and return the latest iteration
 * result for each stage, along with the total iteration count.
 */
function groupStages(stages: StageResult[]): Map<StageName, ResolvedStage> {
  const map = new Map<StageName, ResolvedStage>();

  for (const result of stages) {
    const info = resolveStageInfo(result);
    if (!info) continue;

    const existing = map.get(info.stage);
    if (!existing || info.iteration > existing.maxIteration) {
      map.set(info.stage, {
        name: info.stage,
        latestResult: result,
        maxIteration: info.iteration,
      });
    }
  }

  return map;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: StageStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case StageStatus.PENDING:
      return <Badge variant="outline">Pending</Badge>;
    case StageStatus.RUNNING:
      return (
        <Badge className="animate-pulse bg-blue-500 text-white">Running</Badge>
      );
    case StageStatus.COMPLETED:
      return <Badge className="bg-green-500 text-white">Completed</Badge>;
    case StageStatus.FAILED:
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

interface StageIconProps {
  name: StageName;
  status: StageStatus;
  className?: string;
}

function StageIcon({ name, status, className = "h-5 w-5" }: StageIconProps) {
  const iconClass = `${className} ${
    status === StageStatus.COMPLETED
      ? "text-green-500"
      : status === StageStatus.FAILED
      ? "text-red-500"
      : status === StageStatus.RUNNING
      ? "text-blue-500"
      : "text-muted-foreground"
  }`;

  switch (name) {
    case StageName.REQUIREMENTS:
      return <FileText className={iconClass} />;
    case StageName.CODEGEN:
      return <Code className={iconClass} />;
    case StageName.TESTGEN:
      return <TestTube className={iconClass} />;
    case StageName.SECURITY:
      return <Shield className={iconClass} />;
    case StageName.CODEREVIEW:
      return <Search className={iconClass} />;
    case StageName.DOCUMENTATION:
      return <BookOpen className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
}

function statusIcon(status: StageStatus) {
  switch (status) {
    case StageStatus.COMPLETED:
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case StageStatus.FAILED:
      return <XCircle className="h-3 w-3 text-red-500" />;
    case StageStatus.RUNNING:
      return <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
}

const STAGE_LABELS: Record<StageName, string> = {
  [StageName.REQUIREMENTS]: "Requirements",
  [StageName.CODEGEN]: "Code Gen",
  [StageName.TESTGEN]: "Test Gen",
  [StageName.SECURITY]: "Security",
  [StageName.CODEREVIEW]: "Code Review",
  [StageName.DOCUMENTATION]: "Documentation",
};

interface StageCardProps {
  stageName: StageName;
  resolved: ResolvedStage | undefined;
}

function StageCard({ stageName, resolved }: StageCardProps) {
  const result = resolved?.latestResult ?? null;
  const status = result?.status ?? StageStatus.PENDING;
  const iteration = resolved?.maxIteration ?? 0;

  return (
    <Card className="w-44 shrink-0">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center gap-2">
          <StageIcon name={stageName} status={status} />
          <CardTitle className="text-sm font-medium leading-tight">
            {STAGE_LABELS[stageName]}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {statusIcon(status)}
          <StatusBadge status={status} />
          {iteration > 0 && (
            <Badge
              variant="outline"
              className="text-amber-600 border-amber-400 bg-amber-50 text-xs"
            >
              Iter {iteration}
            </Badge>
          )}
        </div>

        {result?.summary && status === StageStatus.COMPLETED && (
          <p className="text-xs text-muted-foreground leading-snug">
            {truncate(result.summary, 100)}
          </p>
        )}

        {result?.metadata?.duration_seconds != null &&
          status === StageStatus.COMPLETED && (
            <p className="text-xs text-muted-foreground">
              {formatDuration(result.metadata.duration_seconds)}
            </p>
          )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overall status badge
// ---------------------------------------------------------------------------

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  switch (status) {
    case ProjectStatus.CREATED:
      return <Badge variant="outline">Created</Badge>;
    case ProjectStatus.RUNNING:
      return (
        <Badge className="animate-pulse bg-blue-500 text-white">Running</Badge>
      );
    case ProjectStatus.COMPLETED:
      return <Badge className="bg-green-500 text-white">Completed</Badge>;
    case ProjectStatus.FAILED:
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Feedback loop indicator
// ---------------------------------------------------------------------------

function FeedbackLoopIndicator() {
  return (
    <div className="flex items-center gap-1 text-amber-600 text-xs font-medium px-2 py-1 bg-amber-50 border border-amber-200 rounded-md">
      <RotateCcw className="h-3 w-3" />
      <span>Loop back</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrow connector
// ---------------------------------------------------------------------------

function Connector() {
  return <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-6" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineDashboard({
  projectId,
  onViewArtifacts,
}: PipelineDashboardProps) {
  const { project, loading, error } = usePolling(projectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  if (!project) return null;

  const stages = project.stages ?? [];
  const stageMap = groupStages(stages);

  const codeReviewResult = stageMap.get(StageName.CODEREVIEW)?.latestResult;
  const showFeedbackLoop =
    codeReviewResult?.verdict === ReviewVerdict.CHANGES_REQUESTED;

  const hasAnyCompleted = Array.from(stageMap.values()).some(
    (s) => s.latestResult?.status === StageStatus.COMPLETED
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <div className="flex items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            {project.current_iteration != null &&
              project.current_iteration > 0 && (
                <span className="text-xs text-muted-foreground">
                  Iteration {project.current_iteration}
                </span>
              )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onViewArtifacts}
          disabled={!hasAnyCompleted}
        >
          View Artifacts
        </Button>
      </div>

      {/* Pipeline flow
       *
       *  [Requirements] → [Code Gen] → ┌─[Test Gen]──┐ → [Code Review] → [Documentation]
       *                                └─[Security]──┘
       *
       *  Implemented as a single flex row where TestGen and Security are
       *  stacked vertically inside a column container.
       */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-2 min-w-max">
          {/* Requirements */}
          <StageCard
            stageName={StageName.REQUIREMENTS}
            resolved={stageMap.get(StageName.REQUIREMENTS)}
          />

          <Connector />

          {/* Code Gen — feedback loop loops back here */}
          <div className="relative flex flex-col items-center gap-1">
            <StageCard
              stageName={StageName.CODEGEN}
              resolved={stageMap.get(StageName.CODEGEN)}
            />
            {showFeedbackLoop && (
              <div className="absolute -bottom-7">
                <FeedbackLoopIndicator />
              </div>
            )}
          </div>

          <Connector />

          {/* Parallel branch: TestGen + Security stacked */}
          <div className="flex flex-col gap-2">
            <StageCard
              stageName={StageName.TESTGEN}
              resolved={stageMap.get(StageName.TESTGEN)}
            />
            <StageCard
              stageName={StageName.SECURITY}
              resolved={stageMap.get(StageName.SECURITY)}
            />
          </div>

          <Connector />

          {/* Code Review */}
          <StageCard
            stageName={StageName.CODEREVIEW}
            resolved={stageMap.get(StageName.CODEREVIEW)}
          />

          <Connector />

          {/* Documentation */}
          <StageCard
            stageName={StageName.DOCUMENTATION}
            resolved={stageMap.get(StageName.DOCUMENTATION)}
          />
        </div>
      </div>

      {/* Feedback loop explanation */}
      {showFeedbackLoop && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <RotateCcw className="h-4 w-4 shrink-0" />
          <span>
            Code Review requested changes — pipeline is looping back to Code Gen
            for revision.
          </span>
        </div>
      )}
    </div>
  );
}
