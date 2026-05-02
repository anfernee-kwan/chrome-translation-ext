import { getTargetLanguage } from './targetLanguages.js';

export function buildSystemPrompt(targetLanguage) {
  const target = getTargetLanguage(targetLanguage);
  return `You are a professional translator. Translate the numbered source paragraphs into ${target.promptLabel}.
Requirements:
1. Keep the [N] numbering format exactly as provided.
2. Return exactly one translated line per paragraph.
3. Do not add explanations, introductions, or summaries.
4. Preserve proper nouns and technical terms using standard written ${target.promptLabel}.`;
}

function trimTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export async function anthropicTranslate({ baseURL, apiKey, model, batchText, targetLanguage }) {
  const url = `${trimTrailingSlash(baseURL)}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(targetLanguage),
      messages: [{ role: 'user', content: batchText }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('Anthropic API returned no text content');
  return block.text;
}

export async function openaiTranslate(_args) {
  throw new Error('openai-compatible provider not implemented yet');
}

export async function translate({ provider, ...rest }) {
  switch (provider) {
    case 'anthropic': return anthropicTranslate(rest);
    case 'openai-compatible': return openaiTranslate(rest);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
