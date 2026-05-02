export const SYSTEM_PROMPT = `你是专业翻译。将下面带编号的英文段落翻译成简体中文。
要求：
1. 严格保留编号格式 [N] 译文
2. 每段译文一行，不要换行
3. 不要添加任何解释、前言、总结
4. 专业术语和人名/地名按惯例翻译，不确定时保留原文`;

function trimTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export async function anthropicTranslate({ baseURL, apiKey, model, batchText }) {
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
      system: SYSTEM_PROMPT,
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
