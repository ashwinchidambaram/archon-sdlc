import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectCreator } from "@/components/ProjectCreator"
import { PipelineDashboard } from "@/components/PipelineDashboard"
import { ArtifactViewer } from "@/components/ArtifactViewer"
import { usePolling } from "@/hooks/usePolling"

function AppContent({ projectId }: { projectId: string }) {
  const { project } = usePolling(projectId)
  const [activeTab, setActiveTab] = useState<string>("pipeline")

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        <TabsTrigger value="artifacts" disabled={!project?.stages?.length}>
          Artifacts
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pipeline">
        <PipelineDashboard
          projectId={projectId}
          onViewArtifacts={() => setActiveTab("artifacts")}
        />
      </TabsContent>
      <TabsContent value="artifacts">
        {project && (
          <ArtifactViewer
            projectId={projectId}
            stages={project.stages ?? []}
          />
        )}
      </TabsContent>
    </Tabs>
  )
}

function App() {
  const [projectId, setProjectId] = useState<string | null>(null)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Archon SDLC Orchestrator</h1>
            <p className="text-sm text-muted-foreground">
              AI-Powered Multi-Agent Development Pipeline
            </p>
          </div>
          {projectId && (
            <button
              onClick={() => setProjectId(null)}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              New Project
            </button>
          )}
        </div>
      </header>
      <main className="container mx-auto p-6">
        {!projectId ? (
          <div className="max-w-2xl mx-auto">
            <ProjectCreator onPipelineStarted={setProjectId} />
          </div>
        ) : (
          <AppContent projectId={projectId} />
        )}
      </main>
    </div>
  )
}

export default App
