/* WHO THE ORACLE IS.
 *
 * One list, imported by both sides — the same trick contract.js plays with the
 * content vocabulary. The browser renders the provider menu from it and the
 * server validates a saved choice against it, so the menu can never offer an
 * endpoint the server does not know how to speak to.
 *
 * Two dialects cover the field: nearly everything answers on OpenAI's
 * /chat/completions, and Anthropic answers on /messages. Google's Gemini is
 * here under the OpenAI dialect because it publishes a compatible endpoint.
 *
 * The models listed are suggestions shown in a datalist, not a whitelist — the
 * field stays free text, because a list of model names starts going stale the
 * day it is written.
 */

export const DIALECTS = ['openai', 'anthropic'];

export const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyRequired: true,
    keyHint: 'platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    keyRequired: true,
    keyHint: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    dialect: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    keyRequired: true,
    keyHint: 'aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    label: 'Groq',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    keyRequired: true,
    keyHint: 'console.groq.com/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    dialect: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    keyRequired: true,
    keyHint: 'console.mistral.ai/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
    keyRequired: true,
    keyHint: 'openrouter.ai/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (on this machine)',
    dialect: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'mistral', 'qwen2.5'],
    keyRequired: false,
    keyHint: 'no key needed — run `ollama serve`',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (on this machine)',
    dialect: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    models: [],
    keyRequired: false,
    keyHint: 'no key needed — start the local server in LM Studio',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    dialect: 'openai',
    baseUrl: '',
    models: [],
    keyRequired: false,
    keyHint: 'anything that speaks one of the two dialects',
    custom: true,
  },
];

export const DEFAULT_PROVIDER = 'openai';

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

/* Fills in whatever the caller left out, from the provider's own defaults.
 * A custom provider keeps its dialect, since that is the whole point of it. */
export function resolveOracle(raw) {
  const wanted = raw && typeof raw === 'object' ? raw : {};
  const provider = providerById(wanted.provider) || providerById(DEFAULT_PROVIDER);
  const dialect = DIALECTS.includes(wanted.dialect) ? wanted.dialect : provider.dialect;
  const baseUrl = trimSlash(String(wanted.baseUrl || provider.baseUrl || ''));
  const model = String(wanted.model || provider.models[0] || '').trim();
  return { provider: provider.id, dialect, baseUrl, model };
}

export function trimSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/* An oracle can only be asked something if it has somewhere to ask and, for
 * the hosted providers, something to prove who is asking. */
export function oracleReady(settings, hasKey) {
  if (!settings || !settings.baseUrl || !settings.model) return false;
  const p = providerById(settings.provider);
  if (p && p.keyRequired === false) return true;
  return Boolean(hasKey);
}
