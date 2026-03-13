import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectCreator } from "@/components/ProjectCreator"
import { PipelineDashboard } from "@/components/PipelineDashboard"
import { ArtifactViewer } from "@/components/ArtifactViewer"
import { LoginPage } from "@/components/LoginPage"
import { AuthProvider, useAuth } from "@/auth/AuthContext"
import { usePolling } from "@/hooks/usePolling"
import { Logo } from "@/components/Logo"
import ProjectList from "@/components/ProjectList"

type AppView = 'create' | 'list' | 'pipeline'

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
  const [view, setView] = useState<AppView>('create')
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
      <header className="border-b bg-card px-6" style={{ height: '72px', display: 'flex', alignItems: 'center' }}>
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <span className="text-xl font-semibold text-foreground">Archon SDLC</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={() => setView('create')}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              New Project
            </button>
            <button
              onClick={() => setView('list')}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Projects
            </button>
            <span className="text-sm text-muted-foreground">{user}</span>
            <button
              onClick={signOut}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>
      <main className="container mx-auto p-6">
        {view === 'create' && (
          <div className="max-w-2xl mx-auto">
            <ProjectCreator
              onPipelineStarted={(id) => {
                setProjectId(id)
                setView('pipeline')
              }}
            />
          </div>
        )}
        {view === 'list' && (
          <ProjectList
            onSelectProject={(id) => {
              if (id === 'new') {
                setView('create')
              } else {
                setProjectId(id)
                setView('pipeline')
              }
            }}
          />
        )}
        {view === 'pipeline' && projectId && (
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
