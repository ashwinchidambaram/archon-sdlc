import { useState, useEffect, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getArtifact } from "@/api/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Download, Loader2 } from "lucide-react"
import JSZip from "jszip"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ArtifactViewerProps {
  projectId: string
  stages: any[]
}

interface ParsedStage {
  stageName: string
  iteration: number
  s3Key: string
  status: string
  summary?: string | null
  verdict?: string | null
}

interface CodeManifestFile {
  path: string
  description: string
  content: string
}

interface CodeManifest {
  files: CodeManifestFile[]
}

interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  category: string
  source: "bandit" | "manual_review" | string
  title: string
  description: string
  remediation: string
}

interface SecurityReport {
  summary: {
    total_findings: number
    critical: number
    high: number
    medium: number
    low: number
    overall_risk: string
  }
  findings: SecurityFinding[]
}

interface ReviewDimension {
  score: number
  feedback: string
}

interface ReviewIssue {
  priority: "P1" | "P2" | "P3" | string
  description: string
  suggestion: string
}

interface CodeReviewReport {
  overall_score: number
  verdict: "APPROVED" | "APPROVED_WITH_COMMENTS" | "CHANGES_REQUESTED" | string
  summary: string
  dimensions: Record<string, ReviewDimension>
  top_issues: ReviewIssue[]
  commendations: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_TABS = [
  { key: "requirements", label: "Requirements" },
  { key: "codegen", label: "Code Gen" },
  { key: "testgen", label: "Tests" },
  { key: "security", label: "Security" },
  { key: "codereview", label: "Code Review" },
  { key: "documentation", label: "Documentation" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStages(rawStages: any[]): ParsedStage[] {
  return rawStages
    .filter((s) => s.s3_key)
    .map((s) => {
      const parts = (s.s3_key as string).split("/")
      // Format: proj_xxx/requirements/iter0/file.ext
      const stageName = parts[1] ?? s.stage ?? ""
      const iterPart = parts[2] ?? "iter0"
      const iteration = parseInt(iterPart.replace("iter", ""), 10) || 0
      return {
        stageName,
        iteration,
        s3Key: s.s3_key,
        status: s.status,
        summary: s.summary,
        verdict: s.verdict,
      }
    })
}

function groupByStage(parsed: ParsedStage[]): Record<string, ParsedStage[]> {
  return parsed.reduce<Record<string, ParsedStage[]>>((acc, stage) => {
    if (!acc[stage.stageName]) acc[stage.stageName] = []
    acc[stage.stageName].push(stage)
    return acc
  }, {})
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    py: "python",
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    html: "html",
    css: "css",
    sql: "sql",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    tf: "hcl",
    toml: "toml",
    ini: "ini",
    xml: "xml",
  }
  return map[ext] ?? "text"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
      Loading artifact…
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-red-500 text-sm px-4 text-center">
      {message}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
      No {label} results yet.
    </div>
  )
}

// ── Markdown viewer ────────────────────────────────────────────────────────────

function MarkdownViewer({ content }: { content: string }) {
  return (
    <ScrollArea className="h-[600px] w-full">
      <div className="p-4 prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </ScrollArea>
  )
}

// ── Code file viewer ───────────────────────────────────────────────────────────

function CodeViewer({ manifest }: { manifest: CodeManifest }) {
  const [selectedFile, setSelectedFile] = useState<string>(
    manifest.files[0]?.path ?? ""
  )

  const activeFile = manifest.files.find((f) => f.path === selectedFile)

  return (
    <div className="flex flex-col gap-3">
      {/* File selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 font-medium shrink-0">File:</span>
        <Select value={selectedFile} onValueChange={setSelectedFile}>
          <SelectTrigger className="w-full max-w-md h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {manifest.files.map((file) => (
              <SelectItem key={file.path} value={file.path} className="text-xs font-mono">
                {file.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFile?.description && (
          <span className="text-xs text-gray-400 truncate">{activeFile.description}</span>
        )}
      </div>

      {/* Code content */}
      <ScrollArea className="h-[540px] w-full rounded-md border">
        {activeFile ? (
          <SyntaxHighlighter
            language={getLanguageFromPath(activeFile.path)}
            style={oneDark}
            customStyle={{ margin: 0, borderRadius: "0.375rem", fontSize: "0.8rem" }}
            showLineNumbers
          >
            {activeFile.content}
          </SyntaxHighlighter>
        ) : (
          <div className="p-4 text-gray-400 text-sm">Select a file to view its content.</div>
        )}
      </ScrollArea>
    </div>
  )
}

// ── Security report viewer ─────────────────────────────────────────────────────

const severityConfig: Record<string, { label: string; className: string }> = {
  CRITICAL: { label: "Critical", className: "bg-red-600 text-white border-transparent" },
  HIGH: { label: "High", className: "bg-orange-500 text-white border-transparent" },
  MEDIUM: { label: "Medium", className: "bg-yellow-400 text-gray-900 border-transparent" },
  LOW: { label: "Low", className: "bg-gray-300 text-gray-800 border-transparent" },
}

const sourceConfig: Record<string, string> = {
  bandit: "bg-red-100 text-red-700 border-red-200",
  manual_review: "bg-blue-100 text-blue-700 border-blue-200",
}

function SecurityViewer({ report }: { report: SecurityReport }) {
  const { summary, findings } = report

  return (
    <ScrollArea className="h-[600px] w-full">
      <div className="p-4 space-y-4">
        {/* Summary card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Risk Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold text-gray-800">{summary.overall_risk}</span>
              <div className="flex gap-2 flex-wrap">
                {summary.critical > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-semibold">
                    {summary.critical} Critical
                  </span>
                )}
                {summary.high > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500 text-white font-semibold">
                    {summary.high} High
                  </span>
                )}
                {summary.medium > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-400 text-gray-900 font-semibold">
                    {summary.medium} Medium
                  </span>
                )}
                {summary.low > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-semibold">
                    {summary.low} Low
                  </span>
                )}
                {summary.total_findings === 0 && (
                  <span className="text-xs text-green-600 font-medium">No findings</span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">{summary.total_findings} total finding{summary.total_findings !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        {/* Findings list */}
        {findings.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">No findings reported.</div>
        ) : (
          <div className="space-y-3">
            {findings.map((finding, idx) => {
              const sevCfg = severityConfig[finding.severity] ?? severityConfig.LOW
              const srcCls = sourceConfig[finding.source] ?? "bg-gray-100 text-gray-600 border-gray-200"
              return (
                <Card key={idx}>
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Badge className={sevCfg.className}>{sevCfg.label}</Badge>
                      <Badge className={`border ${srcCls}`} variant="outline">
                        {finding.source === "manual_review" ? "manual review" : finding.source}
                      </Badge>
                      <span className="text-xs text-gray-500">{finding.category}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-800">{finding.title}</p>
                    <p className="text-xs text-gray-600">{finding.description}</p>
                    {finding.remediation && (
                      <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                        <p className="text-xs text-blue-700">
                          <span className="font-semibold">Remediation: </span>
                          {finding.remediation}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ── Code review viewer ─────────────────────────────────────────────────────────

const verdictConfig: Record<string, { label: string; className: string }> = {
  APPROVED: {
    label: "Approved",
    className: "bg-green-50 border-green-200 text-green-800",
  },
  APPROVED_WITH_COMMENTS: {
    label: "Approved with Comments",
    className: "bg-blue-50 border-blue-200 text-blue-800",
  },
  CHANGES_REQUESTED: {
    label: "Changes Requested",
    className: "bg-amber-50 border-amber-200 text-amber-800",
  },
}

const priorityConfig: Record<string, string> = {
  P1: "bg-red-100 text-red-700 border-red-200",
  P2: "bg-yellow-100 text-yellow-700 border-yellow-200",
  P3: "bg-gray-100 text-gray-600 border-gray-200",
}

const DIMENSION_LABELS: Record<string, string> = {
  spec_compliance: "Spec Compliance",
  code_quality: "Code Quality",
  test_coverage: "Test Coverage",
  security: "Security",
  performance: "Performance",
  maintainability: "Maintainability",
  documentation: "Documentation",
}

function CodeReviewViewer({ report }: { report: CodeReviewReport }) {
  const vCfg = verdictConfig[report.verdict] ?? verdictConfig.CHANGES_REQUESTED

  return (
    <ScrollArea className="h-[600px] w-full">
      <div className="p-4 space-y-4">
        {/* Verdict banner */}
        <div className={`rounded-lg border px-4 py-3 flex items-center justify-between gap-4 ${vCfg.className}`}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">Verdict</p>
            <p className="font-semibold">{vCfg.label}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">Overall Score</p>
            <p className="text-2xl font-bold">{report.overall_score.toFixed(1)}<span className="text-sm font-normal opacity-60">/10</span></p>
          </div>
        </div>

        {/* Summary */}
        {report.summary && (
          <p className="text-sm text-gray-600 leading-relaxed">{report.summary}</p>
        )}

        {/* Dimension scores */}
        {report.dimensions && Object.keys(report.dimensions).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Dimension Scores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(report.dimensions).map(([key, dim]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 font-medium">
                      {DIMENSION_LABELS[key] ?? key.replace(/_/g, " ")}
                    </span>
                    <span className="text-gray-500">{dim.score}/10</span>
                  </div>
                  <Progress value={dim.score * 10} className="h-2" />
                  {dim.feedback && (
                    <p className="text-xs text-gray-500 pt-0.5">{dim.feedback}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Top issues */}
        {report.top_issues?.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">Top Issues</h3>
            {report.top_issues.map((issue, idx) => {
              const priCls = priorityConfig[issue.priority] ?? priorityConfig.P3
              return (
                <Card key={idx}>
                  <CardContent className="pt-3 pb-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Badge className={`border text-xs ${priCls}`} variant="outline">
                        {issue.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-800">{issue.description}</p>
                    {issue.suggestion && (
                      <p className="text-xs text-gray-500 italic">{issue.suggestion}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Commendations */}
        {report.commendations?.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">Commendations</h3>
            <ul className="space-y-1.5">
              {report.commendations.map((c, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-0.5 text-green-500 shrink-0">&#10003;</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ─── Stage Tab Content ────────────────────────────────────────────────────────

interface StageTabContentProps {
  stageKey: string
  stageLabel: string
  stageResults: ParsedStage[]
  activeTab: string
}

function StageTabContent({ stageKey, stageLabel, stageResults, activeTab }: StageTabContentProps) {
  const iterations = stageResults
    .slice()
    .sort((a, b) => b.iteration - a.iteration) // most recent first for the default

  const [selectedIteration, setSelectedIteration] = useState<string>(
    String(iterations[0]?.iteration ?? 0)
  )
  const [artifactContent, setArtifactContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeParsedStage = iterations.find(
    (s) => String(s.iteration) === selectedIteration
  ) ?? iterations[0]

  // Re-sync default iteration when stageResults changes (e.g. new iteration arrives)
  useEffect(() => {
    if (iterations.length > 0) {
      setSelectedIteration(String(iterations[0].iteration))
    }
  }, [stageResults.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load: only fetch when this tab is active
  useEffect(() => {
    if (activeTab !== stageKey) return
    if (!activeParsedStage?.s3Key) return

    let cancelled = false
    setLoading(true)
    setArtifactContent(null)
    setError(null)

    getArtifact(activeParsedStage.s3Key)
      .then((text) => {
        if (!cancelled) setArtifactContent(text)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load artifact.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, stageKey, activeParsedStage?.s3Key])

  if (stageResults.length === 0) {
    return <EmptyState label={stageLabel} />
  }

  return (
    <div className="space-y-3">
      {/* Iteration selector — only shown when there are multiple */}
      {iterations.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Iteration:</span>
          <Select value={selectedIteration} onValueChange={setSelectedIteration}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {iterations.map((s) => (
                <SelectItem key={s.iteration} value={String(s.iteration)} className="text-xs">
                  Iteration {s.iteration}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content area */}
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && artifactContent !== null && (
        <ArtifactContent stageKey={stageKey} rawContent={artifactContent} />
      )}
    </div>
  )
}

// ─── Artifact content renderer ────────────────────────────────────────────────

function ArtifactContent({ stageKey, rawContent }: { stageKey: string; rawContent: string }) {
  const isMarkdownStage = stageKey === "requirements" || stageKey === "documentation"
  const isCodeStage = stageKey === "codegen" || stageKey === "testgen"
  const isSecurityStage = stageKey === "security"
  const isReviewStage = stageKey === "codereview"

  if (isMarkdownStage) {
    return <MarkdownViewer content={rawContent} />
  }

  if (isCodeStage) {
    let manifest: CodeManifest
    try {
      manifest = JSON.parse(rawContent) as CodeManifest
    } catch {
      return <ErrorState message="Failed to parse code manifest — invalid JSON." />
    }
    if (!manifest.files || manifest.files.length === 0) {
      return <ErrorState message="Manifest contains no files." />
    }
    return <CodeViewer manifest={manifest} />
  }

  if (isSecurityStage) {
    let report: SecurityReport
    try {
      report = JSON.parse(rawContent) as SecurityReport
    } catch {
      return <ErrorState message="Failed to parse security report — invalid JSON." />
    }
    return <SecurityViewer report={report} />
  }

  if (isReviewStage) {
    let report: CodeReviewReport
    try {
      report = JSON.parse(rawContent) as CodeReviewReport
    } catch {
      return <ErrorState message="Failed to parse code review report — invalid JSON." />
    }
    return <CodeReviewViewer report={report} />
  }

  // Fallback: render as plain text
  return (
    <ScrollArea className="h-[600px] w-full">
      <pre className="p-4 text-xs text-gray-700 whitespace-pre-wrap font-mono">{rawContent}</pre>
    </ScrollArea>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const STAGE_FILE_EXT: Record<string, string> = {
  requirements: "md",
  documentation: "md",
  security: "json",
  codereview: "json",
}

export function ArtifactViewer({ projectId, stages }: ArtifactViewerProps) {
  const [activeTab, setActiveTab] = useState<string>(STAGE_TABS[0].key)
  const [downloading, setDownloading] = useState(false)

  const parsedStages = parseStages(stages)
  const grouped = groupByStage(parsedStages)

  const handleDownloadAll = useCallback(async () => {
    setDownloading(true)
    try {
      const zip = new JSZip()

      // For each stage, fetch the latest iteration's artifact and add to zip
      for (const { key } of STAGE_TABS) {
        const stageResults = grouped[key]
        if (!stageResults || stageResults.length === 0) continue

        // Get the latest iteration
        const latest = stageResults.reduce((a, b) => (a.iteration > b.iteration ? a : b))
        const content = await getArtifact(latest.s3Key)

        const folder = `${key}/iter${latest.iteration}`

        if (key === "codegen" || key === "testgen") {
          // Parse manifest and add individual source files
          try {
            const manifest = JSON.parse(content) as CodeManifest
            for (const file of manifest.files) {
              zip.file(`${folder}/${file.path}`, file.content)
            }
          } catch {
            // Fallback: add raw content
            zip.file(`${folder}/manifest.json`, content)
          }
        } else {
          const ext = STAGE_FILE_EXT[key] ?? "txt"
          zip.file(`${folder}/${key}.${ext}`, content)
        }
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${projectId}-artifacts.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Failed to download artifacts:", err)
    } finally {
      setDownloading(false)
    }
  }, [grouped, projectId])

  const hasAnyArtifact = parsedStages.length > 0

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-gray-100 p-1 rounded-lg">
        {STAGE_TABS.map(({ key, label }) => {
          const hasResults = (grouped[key]?.length ?? 0) > 0
          return (
            <TabsTrigger
              key={key}
              value={key}
              className="relative text-xs px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {label}
              {hasResults && (
                <span className="ml-1.5 inline-flex items-center justify-center w-2 h-2 rounded-full bg-green-500" />
              )}
            </TabsTrigger>
          )
        })}
        </TabsList>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadAll}
          disabled={!hasAnyArtifact || downloading}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {downloading ? "Zipping..." : "Download All"}
        </Button>
      </div>

      {STAGE_TABS.map(({ key, label }) => (
        <TabsContent key={key} value={key} className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <StageTabContent
                stageKey={key}
                stageLabel={label}
                stageResults={grouped[key] ?? []}
                activeTab={activeTab}
              />
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  )
}
