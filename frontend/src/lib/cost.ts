import type { StageMetadata } from '@/types';

const PRICING: Record<string, { input: number; output: number }> = {
  'us.amazon.nova-pro-v1:0':     { input: 0.0008, output: 0.0032 },
  'us.amazon.nova-premier-v1:0': { input: 0.0025, output: 0.0125 },
  'us.amazon.nova-lite-v1:0':    { input: 0.00006, output: 0.00024 },
  'mistral.devstral-2-123b':     { input: 0.001, output: 0.003 },
};

export function calculateCost(metadata: StageMetadata): number {
  const p = PRICING[metadata.model_id] ?? { input: 0.001, output: 0.003 };
  return (metadata.input_tokens / 1000) * p.input + (metadata.output_tokens / 1000) * p.output;
}
