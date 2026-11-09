import { FAST_OPENROUTER_MODEL } from '../lib/storage';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const MODEL_PRESETS = {
  openrouter: { name: 'OpenRouter', url: OPENROUTER_URL, help: 'Paste an OpenRouter API key. Tab Sorter starts with a free model when you haven’t selected one.', link: 'https://openrouter.ai/settings/keys', linkLabel: 'Get an OpenRouter API key' },
  anthropic: { name: 'Claude', url: 'https://api.anthropic.com', help: 'Paste a key from the Claude Console. Grouping requests use your Claude API account.', link: 'https://platform.claude.com/settings/keys', linkLabel: 'Get a Claude API key' },
  ollama: { name: 'Ollama', url: 'http://localhost:11434', help: 'Start Ollama and download a chat model. Tab Sorter finds the models installed there.', link: 'https://docs.ollama.com/quickstart', linkLabel: 'Ollama setup guide' },
  openai: { name: 'custom provider', url: 'https://api.openai.com/v1', help: 'Enter the provider’s Chat Completions base URL and API key. Choose a model from its list if one is available.', link: '', linkLabel: '' },
};
export type ModelPreset = keyof typeof MODEL_PRESETS;
export interface ModelChoice { id: string; label: string; free?: boolean }

async function catalogRequest(url: string, headers: Record<string, string>, preset: ModelPreset): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new Error(preset === 'ollama'
      ? 'Could not reach Ollama. Start it, then try again.'
      : `Could not reach ${MODEL_PRESETS[preset].name}. Check your connection and try again.`);
  }
  if (response.ok) return response;
  void response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) {
    throw new Error(preset === 'ollama' ? 'Ollama denied access. Allow the Tab Sorter extension’s origin in Ollama, then try again.' : 'The provider denied access. Check your API key and account permissions.');
  }
  if (preset === 'openai' && [404, 405, 501].includes(response.status)) {
    throw new Error('This endpoint does not list models. Enter a Model ID under Advanced connection settings.');
  }
  throw new Error(`Could not load models from ${MODEL_PRESETS[preset].name} (HTTP ${response.status}).`);
}

interface CatalogItem {
  id?: string;
  name?: string;
  model?: string;
  display_name?: string;
  lifecycle?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
  details?: { family?: string };
  remote_host?: string;
}

export async function loadModels(preset: ModelPreset, apiKey: string, configuredBase: string): Promise<ModelChoice[]> {
  if (preset !== 'ollama' && !apiKey) throw new Error(`Paste your ${MODEL_PRESETS[preset].name} API key first.`);
  const base = preset === 'ollama' || preset === 'openai' ? configuredBase.replace(/\/+$/, '') : MODEL_PRESETS[preset].url;
  if (preset === 'openrouter') {
    const keyCheck = await catalogRequest(base + '/key', { Authorization: 'Bearer ' + apiKey }, preset);
    await keyCheck.body?.cancel().catch(() => undefined);
    const response = await catalogRequest(base + '/models?output_modalities=text&supported_parameters=response_format', {}, preset);
    const { data } = await response.json() as { data?: CatalogItem[] };
    return (Array.isArray(data) ? data : []).flatMap(item => {
      if (!item.id || !item.architecture?.input_modalities?.includes('text')
        || !item.architecture.output_modalities?.includes('text') || !item.supported_parameters?.includes('response_format')) return [];
      const free = (item.id.endsWith(':free') || item.id === 'openrouter/free')
        && item.pricing?.prompt === '0' && item.pricing?.completion === '0';
      return [{ id: item.id, label: item.name || item.id, free }];
    }).sort((a, b) => Number(b.free) - Number(a.free));
  }
  if (preset === 'anthropic') {
    const response = await catalogRequest(base + '/v1/models', {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }, preset);
    const { data } = await response.json() as { data?: CatalogItem[] };
    return (Array.isArray(data) ? data : []).flatMap(item => item.id && !['retired', 'deprecated'].includes(item.lifecycle ?? '')
      ? [{ id: item.id, label: item.display_name || item.id }] : []);
  }
  if (preset === 'openai') {
    const response = await catalogRequest(base + '/models', { Authorization: 'Bearer ' + apiKey }, preset);
    const { data } = await response.json() as { data?: CatalogItem[] };
    return (Array.isArray(data) ? data : []).flatMap(item => item.id ? [{ id: item.id, label: item.name || item.id }] : []);
  }
  const response = await catalogRequest(base + '/api/tags', {}, preset);
  const { models } = await response.json() as { models?: CatalogItem[] };
  return (Array.isArray(models) ? models : []).flatMap(item => {
    const id = item.model || item.name;
    return id && !item.remote_host && !/(?:^|[:-])cloud(?:$|[-:])/i.test(id) &&
      !/embed|rerank/i.test(item.details?.family ?? id) ? [{ id, label: item.name || id }] : [];
  });
}

export function defaultModel(preset: ModelPreset, models: ModelChoice[], selected: string): ModelChoice | undefined {
  const existing = models.find(m => m.id === selected);
  if (existing) return existing;
  if (preset === 'openrouter') {
    return models.find(m => m.free && m.id === FAST_OPENROUTER_MODEL) ?? models.find(m => m.free);
  }
  if (preset === 'anthropic') return models.find(m => /haiku/i.test(m.id));
  return preset === 'ollama' ? models[0] : undefined;
}
