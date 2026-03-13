import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { listProjects } from '@/api/client';
import type { ProjectListItem } from '@/types';

interface ProjectListProps {
  onSelectProject: (projectId: string) => void;
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  created: { backgroundColor: '#E8DCC4', color: '#5A5A5A' },
  running: { backgroundColor: '#D4745E', color: '#F9F7F4' },
  completed: { backgroundColor: '#91A888', color: '#F9F7F4' },
  failed: { backgroundColor: '#C17B6F', color: '#F9F7F4' },
};

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function ProjectList({ onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchProjects = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listProjects();
        if (!cancelled) {
          setProjects(data.projects);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#D4745E' }} />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (projects.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          padding: '3rem',
          color: '#5A5A5A',
        }}
      >
        <p style={{ fontSize: '1rem', margin: 0 }}>No projects yet</p>
        <button
          onClick={() => onSelectProject('new')}
          style={{
            backgroundColor: '#D4745E',
            color: '#F9F7F4',
            border: 'none',
            borderRadius: '6px',
            padding: '0.5rem 1.25rem',
            fontSize: '0.875rem',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Create new project
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {projects.map((project) => {
        const badgeStyle: React.CSSProperties = {
          ...(STATUS_STYLES[project.status] ?? STATUS_STYLES.created),
          display: 'inline-block',
          padding: '0.2rem 0.6rem',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'capitalize',
          letterSpacing: '0.02em',
        };

        return (
          <Card
            key={project.project_id}
            onClick={() => onSelectProject(project.project_id)}
            style={{
              backgroundColor: '#FAF8F3',
              border: '1px solid #E8DCC4',
              cursor: 'pointer',
              transition: 'box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
            }}
          >
            <CardContent style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      margin: '0 0 0.25rem 0',
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      color: '#2C2C2C',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {project.name}
                  </p>
                  <p
                    style={{
                      margin: '0 0 0.5rem 0',
                      fontSize: '0.825rem',
                      color: '#6B6B6B',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {project.description}
                  </p>
                  <span style={{ fontSize: '0.75rem', color: '#9A9A9A' }}>
                    {formatDate(project.created_at)}
                  </span>
                </div>
                <span style={badgeStyle}>{project.status}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
