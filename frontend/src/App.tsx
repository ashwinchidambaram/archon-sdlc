import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectCreator } from "@/components/ProjectCreator"
import { PipelineDashboard } from "@/components/PipelineDashboard"
import { ArtifactViewer } from "@/components/ArtifactViewer"
import { LoginPage } from "@/components/LoginPage"
import { AuthProvider, useAuth } from "@/auth/AuthContext"
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
  const { user, isAuthenticated, isLoading, signOut } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

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
          <div className="flex items-center gap-4">
            {projectId && (
              <button
                onClick={() => setProjectId(null)}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                New Project
              </button>
            )}
            <span className="text-sm text-muted-foreground">{user}</span>
            <button
              onClick={signOut}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Sign Out
            </button>
          </div>
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

function AppWithAuth() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  )
}

export default AppWithAuth
