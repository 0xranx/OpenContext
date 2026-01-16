#!/usr/bin/env node

const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const store = require('../core/store/index.js');
const { Searcher, Indexer } = require('../core/search/index.js');

const server = new McpServer({
  name: 'opencontext-mcp',
  version: '0.1.0'
});

function toToolResponse(data) {
  // Wrap arrays in object to comply with MCP structuredContent requirement (must be record, not array)
  const structured = Array.isArray(data) ? { items: data } : data;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: structured
  };
}

server.registerTool(
  'oc_list_folders',
  {
    description: '列出 OpenContext 中的目录列表（scope=all 表示包含子目录）',
    inputSchema: z.object({
      scope: z.enum(['root', 'all']).optional().describe('默认 root，仅返回顶层目录；all 返回所有目录')
    })
  },
  async ({ scope }) => {
    const folders = store.listFolders({ all: scope === 'all' });
    return toToolResponse(folders);
  }
);

server.registerTool(
  'oc_list_docs',
  {
    description: '列出指定目录下的文档',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('相对 contexts/ 的目录路径，例如 "project-a/design"'),
      recursive: z.boolean().optional().describe('是否递归列出子目录文档，默认 false')
    })
  },
  async ({ folder_path, recursive }) => {
    const docs = store.listDocs({ folderPath: folder_path, recursive: Boolean(recursive) });
    return toToolResponse(docs);
  }
);

server.registerTool(
  'oc_create_doc',
  {
    description: '在指定目录创建空文档（可附带描述）',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('目标目录，相对 contexts/'),
      doc_name: z.string().min(1).describe('文件名，例如 "plan.md"'),
      description: z.string().optional().describe('文档描述')
    })
  },
  async ({ folder_path, doc_name, description }) => {
    const result = store.createDoc({ folderPath: folder_path, name: doc_name, description: description || '' });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_set_doc_desc',
  {
    description: '更新文档描述，便于后续搜索/筛选',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('文档路径，例如 "project-a/plan.md"'),
      description: z.string().describe('新的描述内容')
    })
  },
  async ({ doc_path, description }) => {
    const result = store.setDocDescription({ docPath: doc_path, description });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_manifest',
  {
    description: '输出该目录（含子目录）文档的 JSON manifest，供 Agent 按路径读取上下文',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('相对 contexts/ 的目录路径'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('可选，限制返回文档数量')
    })
  },
  async ({ folder_path, limit }) => {
    const rows = store.generateManifest({ folderPath: folder_path, limit: limit ?? null });
    return toToolResponse(rows);
  }
);

// ===== P0: oc_search =====
server.registerTool(
  'oc_search',
  {
    description: 'Search OpenContext documents by query. Returns matching content/docs/folders with file paths and stable_ids for citation.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query (keywords or natural language)'),
      limit: z.number().int().positive().optional().describe('Number of results (default 5)'),
      mode: z.enum(['hybrid', 'vector', 'keyword']).optional().describe('Search mode (default hybrid)'),
      type: z.enum(['content', 'doc', 'folder']).optional().describe('Aggregation type (default content)')
    })
  },
  async ({ query, limit, mode, type }) => {
    try {
      const searcher = new Searcher();
      const results = await searcher.search(query, {
        limit: limit ?? 5,
        mode: mode ?? 'hybrid',
        aggregateBy: type ?? 'content'
      });
      const jsonOutput = searcher.formatResultsJson(query, results, {
        mode: mode ?? 'hybrid',
        aggregateBy: type ?? 'content'
      });
      return toToolResponse(jsonOutput);
    } catch (err) {
      // Return structured error so Agent can handle degradation
      if (err.message && (err.message.includes('index') || err.message.includes('Index'))) {
        return toToolResponse({
          error: 'INDEX_NOT_AVAILABLE',
          message: 'Search index not built. Use `oc index build` to create it, or fall back to oc_manifest for discovery.',
          query
        });
      }
      throw err;
    }
  }
);

// ===== P1: oc_resolve =====
server.registerTool(
  'oc_resolve',
  {
    description: 'Resolve a stable_id (UUID) to the current document path and metadata. Use this to follow oc://doc/<stable_id> links.',
    inputSchema: z.object({
      stable_id: z.string().uuid().describe('Document stable_id (UUID), e.g. from oc://doc/<stable_id>')
    })
  },
  async ({ stable_id }) => {
    const doc = store.getDocByStableId(stable_id);
    return toToolResponse({
      stable_id: doc.stable_id,
      rel_path: doc.rel_path,
      abs_path: doc.abs_path,
      description: doc.description || '',
      updated_at: doc.updated_at
    });
  }
);

// ===== P1: oc_get_link =====
server.registerTool(
  'oc_get_link',
  {
    description: 'Get the stable link (oc://doc/<stable_id>) for a document. Use this when citing documents.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path relative to contexts/, e.g. "Product/opencontext/agentic/guide"'),
      label: z.string().optional().describe('Optional label for the markdown link (defaults to filename without extension)')
    })
  },
  async ({ doc_path, label }) => {
    const doc = store.getDocMeta({ docPath: doc_path });
    if (!doc.stable_id) {
      throw new Error('stable_id not found. Run `oc init` to ensure schema migration has completed.');
    }
    const linkLabel = label || path.basename(doc.rel_path).replace(/\.md$/i, '');
    const url = `oc://doc/${doc.stable_id}`;
    return toToolResponse({
      stable_id: doc.stable_id,
      url,
      markdown_link: `[${linkLabel}](${url})`,
      rel_path: doc.rel_path,
      abs_path: doc.abs_path
    });
  }
);

// ===== P2: oc_folder_create =====
server.registerTool(
  'oc_folder_create',
  {
    description: 'Create a new folder in OpenContext. Safe to call if folder already exists.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('Folder path relative to contexts/, e.g. "Product/opencontext/ideas"'),
      description: z.string().optional().describe('Optional folder description')
    })
  },
  async ({ folder_path, description }) => {
    const result = store.createFolder({ path: folder_path, description: description || '' });
    return toToolResponse({
      rel_path: result.rel_path,
      abs_path: result.abs_path,
      description: result.description || ''
    });
  }
);

// ===== P2: oc_index_status =====
server.registerTool(
  'oc_index_status',
  {
    description: 'Check search index status. Use this to determine if oc_search is available.',
    inputSchema: z.object({})
  },
  async () => {
    try {
      const indexer = new Indexer();
      await indexer.initialize();
      const exists = await indexer.indexExists();
      
      if (!exists) {
        return toToolResponse({
          available: false,
          message: 'Search index not found. Run `oc index build` to create it.'
        });
      }
      
      const stats = await indexer.getStats();
      return toToolResponse({
        available: true,
        total_chunks: stats.totalChunks || 0,
        last_updated: stats.lastUpdated || null
      });
    } catch (err) {
      return toToolResponse({
        available: false,
        message: `Index check failed: ${err.message}`
      });
    }
  }
);

async function startServer(options = {}) {
  store.initEnvironment();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OpenContext MCP server running (stdio)');
  if (options.autoExit || process.env.OPENCONTEXT_MCP_TEST === '1') {
    setTimeout(() => process.exit(0), 0);
  }
}

module.exports = { startServer };

if (require.main === module) {
  startServer().catch((error) => {
    console.error('OpenContext MCP server failed:', error);
    process.exit(1);
  });
}

