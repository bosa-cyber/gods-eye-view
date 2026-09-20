import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(HERE, '../../tools/agent-reach-bridge.py');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function runBridge(payload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.AGENT_REACH_PYTHON || 'python', [BRIDGE], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Agent Reach exited with code ' + code));
        return;
      }
      try { resolvePromise(JSON.parse(stdout)); }
      catch { reject(new Error('Agent Reach returned invalid JSON')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const TOOLS = [
  { type: 'function', function: {
    name: 'web_read',
    description: 'Read a public web page as clean text using Agent Reach.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  }},
  { type: 'function', function: {
    name: 'youtube_info',
    description: 'Read public YouTube video metadata with Agent Reach and yt-dlp.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  }},
  { type: 'function', function: {
    name: 'github_repo',
    description: 'Read public GitHub repository metadata using Agent Reach and gh CLI.',
    parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
  }},
];

async function handleAgentChat(request) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const routerUrl = (process.env.NINEROUTER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const routerKey = process.env.NINEROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY;
  const model = process.env.NINEROUTER_MODEL || process.env.NINE_ROUTER_MODEL;
  if (!routerKey || !model) {
    return jsonResponse({ error: 'NINEROUTER_API_KEY and NINEROUTER_MODEL are required' }, 500);
  }
  const body = await request.json();
  const messages = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
  if (!messages.length) return jsonResponse({ error: 'messages is required' }, 400);

  for (let turn = 0; turn < 5; turn += 1) {
    const upstream = await fetch(routerUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + routerKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: body.temperature ?? 0.2,
        max_tokens: body.max_tokens ?? 1200,
      }),
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      return new Response(raw, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
    }
    let data;
    try { data = JSON.parse(raw); } catch {
      return jsonResponse({ error: '9Router returned non-JSON', raw }, 502);
    }
    const message = data?.choices?.[0]?.message;
    if (!message) return jsonResponse({ error: '9Router returned no assistant message', raw: data }, 502);
    if (!message.tool_calls?.length) return jsonResponse(data);

    messages.push(message);
    for (const call of message.tool_calls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
      let result;
      try {
        if (name === 'web_read' || name === 'youtube_info' || name === 'github_repo') {
          result = await runBridge({ action: name, ...args });
        } else {
          result = { error: 'Unknown tool: ' + name };
        }
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 30000),
      });
    }
  }
  return jsonResponse({ error: 'Tool-call loop exceeded its safety limit' }, 508);
}

export function agentReachProxy() {
  return {
    name: 'agent-reach-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent/chat', async (req, res) => {
        try {
          const request = new Request('http://localhost/api/agent/chat', {
            method: req.method,
            headers: req.headers,
            body: req.method === 'POST' ? await new Promise((resolvePromise, reject) => {
              const chunks = [];
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => resolvePromise(Buffer.concat(chunks)));
              req.on('error', reject);
            }) : undefined,
          });
          const response = await handleAgentChat(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}
