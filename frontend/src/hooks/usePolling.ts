import { useState, useEffect, useRef, useCallback } from "react";
import { getProject } from "@/api/client";
import type { Project } from "@/types";
import { ProjectStatus } from "@/types";

export function usePolling(projectId: string): {
  project: Project | null;
  loading: boolean;
  error: string | null;
} {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const clearPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchProject = useCallback(async () => {
    try {
      const data = await getProject(projectId);
      if (!isMountedRef.current) return;

      setProject(data);
      setError(null);

      // Stop polling if the pipeline has reached a terminal state
      if (
        data.status === ProjectStatus.COMPLETED ||
        data.status === ProjectStatus.FAILED
      ) {
        clearPolling();
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch project");
      clearPolling();
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectId, clearPolling]);

  useEffect(() => {
    isMountedRef.current = true;

    // Fetch immediately on mount
    fetchProject().then(() => {
      if (!isMountedRef.current) return;

      // After the initial fetch, set up polling only while running
      // The interval will self-cancel via clearPolling when terminal state is reached
      intervalRef.current = setInterval(() => {
        fetchProject();
      }, 3000);
    });

    return () => {
      isMountedRef.current = false;
      clearPolling();
    };
  }, [projectId, fetchProject, clearPolling]);

  return { project, loading, error };
}
