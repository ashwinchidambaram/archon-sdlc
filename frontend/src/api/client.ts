import type {
  CreateProjectRequest,
  CreateProjectResponse,
  StartPipelineResponse,
  Project,
  StageResult,
  ProjectListItem,
} from '@/types';
import { getIdToken } from '@/auth/cognito';

const getBaseUrl = (): string => {
  const baseUrl = import.meta.env.VITE_API_URL;
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await getIdToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
};

const handleResponse = async (response: Response) => {
  if (!response.ok) {
    try {
      const error = await response.json();
      throw new Error(error.message || error.error || response.statusText);
    } catch (e) {
      if (e instanceof Error && e.message !== response.statusText) {
        throw e;
      }
      throw new Error(response.statusText);
    }
  }
  return response;
};

export const createProject = async (
  req: CreateProjectRequest
): Promise<CreateProjectResponse> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(req),
  });

  await handleResponse(response);
  return response.json();
};

export const startPipeline = async (
  projectId: string
): Promise<StartPipelineResponse> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/projects/${projectId}/run`, {
    method: 'POST',
    headers: { ...authHeaders },
  });

  await handleResponse(response);
  return response.json();
};

export const getProject = async (projectId: string): Promise<Project> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/projects/${projectId}`, {
    headers: { ...authHeaders },
  });
  await handleResponse(response);
  return response.json();
};

export const getStages = async (
  projectId: string
): Promise<{ project_id: string; stages: StageResult[] }> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(
    `${getBaseUrl()}/projects/${projectId}/stages`,
    { headers: { ...authHeaders } }
  );
  await handleResponse(response);
  return response.json();
};

export const getArtifact = async (s3Key: string): Promise<string> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/artifacts/${s3Key}`, {
    headers: { ...authHeaders },
  });
  await handleResponse(response);
  return response.text();
};

export const listProjects = async (): Promise<{ projects: ProjectListItem[] }> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/projects`, {
    headers: { ...authHeaders },
  });
  await handleResponse(response);
  return response.json();
};

export const stopPipeline = async (
  projectId: string
): Promise<{ project_id: string; status: string; message: string }> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/projects/${projectId}/stop`, {
    method: 'POST',
    headers: { ...authHeaders },
  });
  await handleResponse(response);
  return response.json();
};

export const planProject = async (
  description: string
): Promise<{ user_stories: string[]; summary: string }> => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${getBaseUrl()}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ description }),
  });
  await handleResponse(response);
  return response.json();
};
