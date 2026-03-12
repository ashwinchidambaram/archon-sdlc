import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createProject, startPipeline } from "@/api/client"
import type { CreateProjectRequest } from "@/types"
import { Plus, Trash2, Rocket } from "lucide-react"

interface ProjectCreatorProps {
  onPipelineStarted: (projectId: string) => void;
}

export function ProjectCreator({ onPipelineStarted }: ProjectCreatorProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [techStack, setTechStack] = useState("Python, FastAPI, PostgreSQL, React")
  const [userStories, setUserStories] = useState<string[]>([""])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addUserStory = () => {
    setUserStories((prev) => [...prev, ""])
  }

  const removeUserStory = (index: number) => {
    setUserStories((prev) => prev.filter((_, i) => i !== index))
  }

  const updateUserStory = (index: number, value: string) => {
    setUserStories((prev) => prev.map((story, i) => (i === index ? value : story)))
  }

  const hasAnyStory = userStories.some((s) => s.trim() !== "")
  const isSubmitDisabled = loading || !name.trim() || !description.trim() || !hasAnyStory

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)

    try {
      const request: CreateProjectRequest = {
        name: name.trim(),
        description: description.trim(),
        tech_stack: techStack,
        user_stories: userStories.filter((s) => s.trim() !== ""),
      }

      const { project_id } = await createProject(request)
      await startPipeline(project_id)
      onPipelineStarted(project_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Project</CardTitle>
        <CardDescription>Define your project requirements to start the AI pipeline</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="project-name">Project Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Project"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this project should do..."
            rows={3}
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tech-stack">Tech Stack</Label>
          <Select value={techStack} onValueChange={setTechStack} disabled={loading}>
            <SelectTrigger id="tech-stack">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Python, FastAPI, PostgreSQL, React">
                Python, FastAPI, PostgreSQL, React
              </SelectItem>
              <SelectItem value="Node.js, Express, MongoDB, React">
                Node.js, Express, MongoDB, React
              </SelectItem>
              <SelectItem value="Java, Spring Boot, PostgreSQL, Angular">
                Java, Spring Boot, PostgreSQL, Angular
              </SelectItem>
              <SelectItem value="Go, Gin, PostgreSQL, React">
                Go, Gin, PostgreSQL, React
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label>User Stories</Label>
          <div className="space-y-3">
            {userStories.map((story, index) => (
              <div key={index} className="flex gap-2 items-start">
                <Textarea
                  value={story}
                  onChange={(e) => updateUserStory(index, e.target.value)}
                  placeholder="As a user, I want..."
                  rows={2}
                  disabled={loading}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeUserStory(index)}
                  disabled={loading || userStories.length === 1}
                  className="mt-1 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addUserStory}
            disabled={loading}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User Story
          </Button>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
          className="w-full"
        >
          <Rocket className="h-4 w-4 mr-2" />
          {loading ? "Starting pipeline..." : "Create & Start Pipeline"}
        </Button>
      </CardContent>
    </Card>
  )
}
