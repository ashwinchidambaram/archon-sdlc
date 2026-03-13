import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/usePolling";
import type { StageResult } from "@/types";
import { StageName, StageStatus, ReviewVerdict, ProjectStatus } from "@/types";
import { calculateCost } from "@/lib/cost";
import {
  Clock,
  Loader2,
  RotateCcw,
  FileText,
  Code,
  TestTube,
  Shield,
  Search,
  BookOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Brand colors
// ---------------------------------------------------------------------------

const BRAND = {
  warmSand: "#E8DCC4",
  offWhite: "#F9F7F4",
  slateGray: "#5A5A5A",
  inkBlack: "#2C2C2C",
  terracotta: "#D4745E",
  sage: "#91A888",
  error: "#C17B6F",
  warmGray: "#9B9B9B",
};

// ---------------------------------------------------------------------------
// Pipeline order
// ---------------------------------------------------------------------------

const PIPELINE_ORDER: StageName[] = [
  StageName.REQUIREMENTS,
  StageName.CODEGEN,
  StageName.TESTGEN,
  StageName.SECURITY,
  StageName.CODEREVIEW,
  StageName.DOCUMENTATION,
];

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

function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
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
      return (
        <Badge
          style={{ backgroundColor: BRAND.warmSand, color: BRAND.slateGray, border: "none" }}
        >
          Pending
        </Badge>
      );
    case StageStatus.RUNNING:
      return (
        <Badge
          className="animate-pulse"
          style={{ backgroundColor: BRAND.terracotta, color: BRAND.offWhite, border: "none" }}
        >
          Running
        </Badge>
      );
    case StageStatus.COMPLETED:
      return (
        <Badge
          style={{ backgroundColor: BRAND.sage, color: BRAND.offWhite, border: "none" }}
        >
          Completed
        </Badge>
      );
    case StageStatus.FAILED:
      return (
        <Badge
          style={{ backgroundColor: BRAND.error, color: BRAND.offWhite, border: "none" }}
        >
          Failed
        </Badge>
      );
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
  const color =
    status === StageStatus.COMPLETED
      ? BRAND.sage
      : status === StageStatus.FAILED
      ? BRAND.error
      : status === StageStatus.RUNNING
      ? BRAND.terracotta
      : BRAND.warmGray;

  const iconStyle = { color };

  switch (name) {
    case StageName.REQUIREMENTS:
      return <FileText className={className} style={iconStyle} />;
    case StageName.CODEGEN:
      return <Code className={className} style={iconStyle} />;
    case StageName.TESTGEN:
      return <TestTube className={className} style={iconStyle} />;
    case StageName.SECURITY:
      return <Shield className={className} style={iconStyle} />;
    case StageName.CODEREVIEW:
      return <Search className={className} style={iconStyle} />;
    case StageName.DOCUMENTATION:
      return <BookOpen className={className} style={iconStyle} />;
    default:
      return <Clock className={className} style={iconStyle} />;
  }
}

function statusBorderColor(status: StageStatus): string {
  switch (status) {
    case StageStatus.COMPLETED:
      return BRAND.sage;
    case StageStatus.FAILED:
      return BRAND.error;
    case StageStatus.RUNNING:
      return BRAND.terracotta;
    default:
      return BRAND.warmGray;
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

  const borderColor = statusBorderColor(status);

  return (
    <Card
      className="w-full"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <CardContent className="p-4 space-y-2">
        {/* Stage name + status on one line */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StageIcon name={stageName} status={status} className="h-4 w-4 shrink-0" />
            <span className="font-medium text-sm">{STAGE_LABELS[stageName]}</span>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Summary */}
        {result?.summary && (
          <p className="text-xs text-muted-foreground leading-snug">
            {truncate(result.summary, 140)}
          </p>
        )}

        {/* Timestamps + duration */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {result?.started_at && (
            <span>Started {formatTimestamp(result.started_at)}</span>
          )}
          {result?.completed_at && (
            <span>Completed {formatTimestamp(result.completed_at)}</span>
          )}
          {result?.metadata?.duration_seconds != null &&
            status === StageStatus.COMPLETED && (
              <span className="font-medium">
                {formatDuration(result.metadata.duration_seconds)}
              </span>
            )}
        </div>
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
      return (
        <Badge
          style={{ backgroundColor: BRAND.warmSand, color: BRAND.slateGray, border: "none" }}
        >
          Created
        </Badge>
      );
    case ProjectStatus.RUNNING:
      return (
        <Badge
          className="animate-pulse"
          style={{ backgroundColor: BRAND.terracotta, color: BRAND.offWhite, border: "none" }}
        >
          Running
        </Badge>
      );
    case ProjectStatus.COMPLETED:
      return (
        <Badge
          style={{ backgroundColor: BRAND.sage, color: BRAND.offWhite, border: "none" }}
        >
          Completed
        </Badge>
      );
    case ProjectStatus.FAILED:
      return (
        <Badge
          style={{ backgroundColor: BRAND.error, color: BRAND.offWhite, border: "none" }}
        >
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Cost panel
// ---------------------------------------------------------------------------

function CostPanel({
  stages,
  stageMap,
}: {
  stages: StageResult[];
  stageMap: Map<StageName, ResolvedStage>;
}) {
  // Aggregate costs from latest iteration of each stage
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;

  const stageCosts: Array<{ name: StageName; cost: number; input: number; output: number }> = [];

  for (const stageName of PIPELINE_ORDER) {
    const resolved = stageMap.get(stageName);
    const meta = resolved?.latestResult?.metadata;
    if (meta) {
      const cost = calculateCost(meta);
      totalCost += cost;
      totalInput += meta.input_tokens;
      totalOutput += meta.output_tokens;
      stageCosts.push({ name: stageName, cost, input: meta.input_tokens, output: meta.output_tokens });
    }
  }

  // Fallback: if stageMap is empty but raw stages have metadata, sum from stages
  if (stageCosts.length === 0 && stages.length > 0) {
    for (const s of stages) {
      if (s.metadata) {
        const cost = calculateCost(s.metadata);
        totalCost += cost;
        totalInput += s.metadata.input_tokens;
        totalOutput += s.metadata.output_tokens;
      }
    }
  }

  return (
    <Card className="sticky top-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Pipeline Cost</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total */}
        <div>
          <div className="text-2xl font-bold" style={{ color: BRAND.inkBlack }}>
            ${totalCost.toFixed(4)}
          </div>
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            <div>{totalInput.toLocaleString()} input tokens</div>
            <div>{totalOutput.toLocaleString()} output tokens</div>
          </div>
        </div>

        {/* Divider */}
        <hr className="border-border" />

        {/* Per-stage breakdown */}
        {stageCosts.length > 0 ? (
          <div className="space-y-3">
            {stageCosts.map(({ name, cost, input, output }) => (
              <div key={name}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{STAGE_LABELS[name]}</span>
                  <span className="text-xs font-semibold">${cost.toFixed(4)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {input.toLocaleString()} in / {output.toLocaleString()} out
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No cost data yet. Costs will appear as stages complete.
          </p>
        )}
      </CardContent>
    </Card>
  );
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left: Pipeline Timeline */}
      <div className="lg:col-span-2 space-y-4">
        {/* Project header */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{project.name}</h2>
            <div className="flex items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              {project.current_iteration != null && project.current_iteration > 0 && (
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

        {/* Vertical stage list with iteration banners */}
        {PIPELINE_ORDER.map((stageName) => {
          const resolved = stageMap.get(stageName);

          // Show feedback loop banner before Code Gen when review requested changes
          const showIterBanner =
            stageName === StageName.CODEGEN &&
            showFeedbackLoop &&
            resolved != null &&
            resolved.maxIteration > 0;

          // Show iteration banner before any stage that has looped
          const showGenericIterBanner =
            stageName !== StageName.CODEGEN &&
            resolved != null &&
            resolved.maxIteration > 0;

          return (
            <div key={stageName} className="space-y-2">
              {showIterBanner && (
                <div
                  className="px-4 py-3 rounded-lg flex items-center gap-2"
                  style={{
                    backgroundColor: BRAND.warmSand,
                    fontSize: "14px",
                    color: BRAND.inkBlack,
                    fontWeight: 500,
                  }}
                >
                  <RotateCcw className="h-4 w-4 shrink-0" style={{ color: BRAND.terracotta }} />
                  <span>
                    Iteration {resolved.maxIteration} — Code Review requested changes
                  </span>
                </div>
              )}
              {showGenericIterBanner && (
                <div
                  className="px-4 py-3 rounded-lg"
                  style={{
                    backgroundColor: BRAND.warmSand,
                    fontSize: "14px",
                    color: BRAND.inkBlack,
                    fontWeight: 500,
                  }}
                >
                  Iteration {resolved.maxIteration} — Code Review requested changes
                </div>
              )}
              <StageCard stageName={stageName} resolved={resolved} />
            </div>
          );
        })}
      </div>

      {/* Right: Cost Panel */}
      <div className="lg:col-span-1">
        <CostPanel stages={stages} stageMap={stageMap} />
      </div>
    </div>
  );
}
