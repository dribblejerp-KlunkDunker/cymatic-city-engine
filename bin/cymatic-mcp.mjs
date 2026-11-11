#!/usr/bin/env node
// Model Context Protocol server for the Cymatic City Engine (stdio, no dependencies).
//
// Exposes agentTools() — generate_city, query_city, ask_city, suggest_metro_station, search_plans — so any
// MCP client (Claude Code, Claude Desktop, other agents) can work with a city through questions instead of
// reading source or geometry. Results are compact JSON text. query_city returns a short page (PAGE rows) unless
// the caller sets `limit`, so a forgotten limit costs hundreds of tokens, not thousands.
//
//   Claude Code:  claude mcp add cymatic -- node /path/to/cymatic-city-engine/bin/cymatic-mcp.mjs
//   or .mcp.json: { "mcpServers": { "cymatic": { "command": "node", "args": ["bin/cymatic-mcp.mjs"] } } }
//
// One server process holds one current city (the last generate_city), as agentTools' state does.
import { createInterface } from 'node:readline';
import { agentTools } from '../src/query.js';
import { ENGINE_VERSION } from '../src/cymatic-engine.js';
import { isMain } from './cymatic.mjs';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const PAGE = 25; // rows query_city returns when the caller sets no limit (the tool's own ceiling is 200)
// what a caller should know before paying for a call; appended to the tool descriptions
const NOTES = {
  query_city: ` Returns the first ${PAGE} rows unless \`limit\` is set (ceiling 200); name \`fields\` to keep rows small.`,
  search_plans: ' Runs to completion before answering: seconds for physics or plan metrics, about two minutes for commute metrics on a city-sized preset at the default budget of 24. Lower `budget` for a first look.',
};

export function createServer() {
  const tools = agentTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const state = {};
  const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  // returns the response object, or null for notifications
  function handle(msg) {
    // a reply to something this server never asked is dropped; anything else that is not a JSON-RPC 2.0 request
    // object (a number, a string, null) is refused, never thrown on
    if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.method === undefined && ('result' in msg || 'error' in msg)) return null;
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(msg && typeof msg === 'object' && 'id' in msg ? msg.id ?? null : null, -32600, 'Invalid request');
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    const isNotification = !('id' in msg);
    if (isNotification) return null; // notifications/initialized, notifications/cancelled …
    try { return dispatch(id, method, params); }
    catch (e) { return error(id, -32603, `Internal error: ${e.message}`); } // the server outlives any one bad request
  }
  function dispatch(id, method, params) {
    switch (method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return result(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'cymatic-city-engine', version: ENGINE_VERSION },
          instructions: 'Generate a city with generate_city (a profile: frequency or chord, plate, preset, seed …), then ask about it with query_city or ask_city. A profile regenerates the same city byte for byte, so refer to cities by profile. Indices in query_city are 0-based; ask_city counts from 1.',
        });
      }
      case 'ping': return result(id, {});
      case 'tools/list':
        // every tool only computes: nothing outside this process changes, and the same input gives the same answer
        return result(id, { tools: tools.map(({ name, description, input_schema }) => ({ name, description: description + (NOTES[name] ?? ''), inputSchema: input_schema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
      case 'tools/call': {
        const tool = byName.get(params.name);
        if (!tool) return error(id, -32602, `Unknown tool "${params.name}". Tools: ${[...byName.keys()].join(', ')}`);
        try {
          const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
          let out = tool.run(args, state);
          if (tool.name === 'query_city' && args.limit === undefined && out.rows.length > PAGE) {
            out = { ...out, rows: out.rows.slice(0, PAGE), note: `first ${PAGE} of ${out.count} matching rows; set limit (up to 200), fields, where or aggregate to get what you need` };
          }
          // text only: a structuredContent copy would double what the client puts in context
          return result(id, { content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
        } catch (e) {
          const hint = /Generate a city first/.test(e.message) ? ' — call generate_city with a profile such as {"profile": {"frequency": 432}} first; the server keeps that city for later calls.' : '';
          return result(id, { content: [{ type: 'text', text: `Error: ${e.message}${hint}` }], isError: true });
        }
      }
      default: return error(id, -32601, `Method not found: ${method}`);
    }
  }
  return { handle, state };
}

function main() {
  const server = createServer();
  const rl = createInterface({ input: process.stdin });
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const batch = Array.isArray(msg) ? msg : [msg];
    const replies = batch.map((m) => server.handle(m)).filter(Boolean);
    if (Array.isArray(msg)) { if (replies.length) send(replies); } else if (replies[0]) send(replies[0]);
  });
}

if (isMain(import.meta.url)) main();
