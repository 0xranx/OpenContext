const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  removeFolder,
  listDocs,
  createDoc,
  getDocMeta,
  getDocByStableId,
  moveDoc,
  renameDoc,
  removeDoc,
  setDocDescription,
  getDocContent,
  saveDocContent
} = require('../core/store/index.js');
const { Searcher, Indexer } = require('../core/search/index.js');
const { indexSync } = require('../core/search/indexSync');
const config = require('../core/config');

async function createUiServer({ host = '127.0.0.1', port = 3222 }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));
  app.use((req, _res, next) => {
    console.log(`[oc ui] ${req.method} ${req.path}`);
    next();
  });

  // Start index sync service (Rust native, interval-based)
  try {
    const started = await indexSync.start({ intervalSecs: 300 }); // 5 minutes
    if (started) {
      console.log('[oc ui] Index sync service started (5 min interval)');
    } else {
      console.log('[oc ui] Index sync service already running');
    }
  } catch (err) {
    console.warn('[oc ui] Failed to start index sync:', err.message);
  }

  // Folders
  app.get('/api/folders', (req, res) => {
    try {
      const folders = listFolders({ all: req.query.all === 'true' });
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/folders', (req, res) => {
    try {
      const { path: folderPath, description } = req.body;
      const result = createFolder({ path: folderPath, description });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/folders/rename', (req, res) => {
    try {
      const { path: folderPath, new_name } = req.body;
      const result = renameFolder({ path: folderPath, newName: new_name });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/folders/move', (req, res) => {
    try {
      const { path: folderPath, dest_folder_path } = req.body || {};
      const result = moveFolder({ path: folderPath, destFolderPath: dest_folder_path });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/folders/delete', (req, res) => {
    try {
      const { path: folderPath, force } = req.body;
      const result = removeFolder({ path: folderPath, force });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Docs
  app.get('/api/docs', (req, res) => {
    try {
      const folderPath = req.query.folder || '';
      const docs = listDocs({ folderPath, recursive: req.query.recursive === 'true' });
      res.json(docs);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Note: /api/docs/search removed - use /api/semantic-search instead

  app.get('/api/docs/by-id/:stableId', (req, res) => {
    try {
      const { stableId } = req.params || {};
      const doc = getDocByStableId(stableId);
      res.json({
        stable_id: doc.stable_id,
        rel_path: doc.rel_path,
        abs_path: doc.abs_path,
        description: doc.description || '',
        updated_at: doc.updated_at
      });
    } catch (error) {
      const msg = String(error?.message || 'Unknown error');
      if (msg.includes('not found')) return res.status(404).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });

  // Get doc meta by rel_path (useful when stable_id is missing on list endpoints in some runtimes)
  app.get('/api/docs/meta', (req, res) => {
    try {
      const docPath = req.query.path;
      if (!docPath) {
        return res.status(400).json({ error: 'Missing "path" query parameter' });
      }
      const doc = getDocMeta({ docPath });
      res.json({
        stable_id: doc.stable_id,
        rel_path: doc.rel_path,
        abs_path: doc.abs_path,
        description: doc.description || '',
        updated_at: doc.updated_at
      });
    } catch (error) {
      const msg = String(error?.message || 'Unknown error');
      if (msg.includes('not found')) return res.status(404).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/docs', (req, res) => {
    try {
      const { folder_path, name, description } = req.body;
      const result = createDoc({ folderPath: folder_path, name, description });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/docs/move', (req, res) => {
    try {
      const { doc_path, dest_folder_path } = req.body;
      const result = moveDoc({ docPath: doc_path, destFolderPath: dest_folder_path });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/docs/rename', (req, res) => {
    try {
      const { doc_path, new_name } = req.body;
      const result = renameDoc({ docPath: doc_path, newName: new_name });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/docs/description', (req, res) => {
    try {
      const { doc_path, description } = req.body;
      const result = setDocDescription({ docPath: doc_path, description });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/docs/content', (req, res) => {
    try {
      const docPath = req.query.path;
      if (!docPath) {
        return res.status(400).json({ error: 'Missing "path" query parameter' });
      }
      const content = getDocContent(docPath);
      res.json({ content });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/docs/save', (req, res) => {
    try {
      const { path: docPath, content, description } = req.body || {};
      if (!docPath || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing path or content' });
      }
      const result = saveDocContent({ docPath, content, description });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/docs/delete', (req, res) => {
    try {
      const { path: docPath } = req.body || {};
      if (!docPath) {
        return res.status(400).json({ error: 'Missing path' });
      }
      const result = removeDoc({ docPath });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/debug-log', (req, res) => {
    console.dir(req.body, { depth: null });
    res.json({ ok: true });
  });

  // Environment & Config API
  app.get('/api/env', (req, res) => {
    try {
      const apiKey = config.get('EMBEDDING_API_KEY');
      const apiBase = config.get('EMBEDDING_API_BASE') || 'https://api.openai.com/v1';
      const model = config.get('EMBEDDING_MODEL') || 'text-embedding-3-small';
      
      // Mask API key
      let apiKeyMasked = null;
      if (apiKey && apiKey.length > 4) {
        apiKeyMasked = `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
      }
      
      res.json({
        embedding_model: model,
        embedding_api_base: apiBase,
        api_key_masked: apiKeyMasked,
        has_api_key: !!apiKey && apiKey.length > 0,
        config_path: config.getConfigPath(),
        dimensions: 1536
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const { apiKey, apiBase, model } = req.body || {};
      
      if (apiKey && apiKey.length > 0) {
        config.set('EMBEDDING_API_KEY', apiKey);
      }
      if (apiBase !== undefined) {
        config.set('EMBEDDING_API_BASE', apiBase);
      }
      if (model !== undefined) {
        config.set('EMBEDDING_MODEL', model);
      }
      
      res.json({ 
        success: true, 
        config_path: config.getConfigPath() 
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // AI Configuration API
  app.get('/api/ai/config', (req, res) => {
    try {
      const provider = config.get('AI_PROVIDER') || 'openai';
      const apiKey = config.get('AI_API_KEY');
      const apiBase = config.get('AI_API_BASE') || 'https://api.openai.com/v1';
      const model = config.get('AI_MODEL') || 'gpt-4o';
      const prompt = config.get('AI_PROMPT') || config.CONFIG_KEYS.AI_PROMPT.default;
      
      let apiKeyMasked = null;
      if (apiKey && apiKey.length > 4) {
        apiKeyMasked = `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
      }
      
      res.json({
        provider,
        model,
        api_base: apiBase,
        api_key_masked: apiKeyMasked,
        has_api_key: !!apiKey && apiKey.length > 0,
        prompt,
        default_prompt: config.CONFIG_KEYS.AI_PROMPT.default
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai/config', (req, res) => {
    try {
      const { provider, apiKey, apiBase, model, prompt } = req.body || {};
      
      if (provider !== undefined) {
        config.set('AI_PROVIDER', provider);
      }
      if (apiKey && apiKey.length > 0) {
        config.set('AI_API_KEY', apiKey);
      }
      if (apiBase !== undefined) {
        config.set('AI_API_BASE', apiBase);
      }
      if (model !== undefined) {
        config.set('AI_MODEL', model);
      }
      if (prompt !== undefined) {
        config.set('AI_PROMPT', prompt);
      }
      
      res.json({ 
        success: true, 
        config_path: config.getConfigPath() 
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // AI Chat Stream API (SSE)
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { messages, model: modelOverride } = req.body || {};
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Missing messages array' });
      }
      const hasMultimodal = messages.some((msg) => Array.isArray(msg.content));
      const toOllamaMessages = (source) => {
        return source.map((msg) => {
          if (!Array.isArray(msg.content)) return msg;
          const textParts = [];
          const images = [];
          for (const part of msg.content) {
            if (part?.type === 'text' && part.text) {
              textParts.push(part.text);
            } else if (part?.type === 'image_url') {
              const url = part?.image_url?.url || '';
              const match = url.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
              if (match?.[1]) {
                images.push(match[1]);
              }
            }
          }
          const next = { ...msg, content: textParts.join('\n') };
          if (images.length > 0) next.images = images;
          return next;
        });
      };

      const provider = config.get('AI_PROVIDER') || 'openai';
      const apiKey = config.get('AI_API_KEY');
      const apiBase = config.get('AI_API_BASE') || 'https://api.openai.com/v1';
      const model = typeof modelOverride === 'string' && modelOverride.trim().length > 0
        ? modelOverride.trim()
        : (config.get('AI_MODEL') || 'gpt-4o');

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      if (provider === 'ollama') {
        // Ollama API
        const ollamaUrl = apiBase.includes('ollama') ? apiBase : 'http://localhost:11434/api';
        const outgoingMessages = hasMultimodal ? toOllamaMessages(messages) : messages;
        const response = await fetch(`${ollamaUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: outgoingMessages, stream: true })
        });

        if (!response.ok) {
          res.write(`data: ${JSON.stringify({ error: `Ollama error: ${response.status}` })}\n\n`);
          res.end();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.trim()) {
              try {
                const json = JSON.parse(line);
                if (json.message?.content) {
                  res.write(`data: ${JSON.stringify({ content: json.message.content })}\n\n`);
                }
                if (json.done) {
                  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      } else {
        // OpenAI-compatible API
        if (!apiKey) {
          res.write(`data: ${JSON.stringify({ error: 'AI API key not configured' })}\n\n`);
          res.end();
          return;
        }

        const response = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            max_tokens: 500
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          res.write(`data: ${JSON.stringify({ error: `API error: ${response.status} - ${errorText}` })}\n\n`);
          res.end();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              } else {
                try {
                  const json = JSON.parse(data);
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    res.write(`data: ${JSON.stringify({ content })}\n\n`);
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
        }
      }

      res.end();
    } catch (error) {
      console.error('[AI Chat Error]', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Index Management API
  let indexerInstance = null;
  
  async function getIndexer() {
    if (!indexerInstance) {
      indexerInstance = new Indexer();
      await indexerInstance.initialize();
    }
    return indexerInstance;
  }
  
  app.get('/api/index/status', async (req, res) => {
    try {
      const indexer = await getIndexer();
      const exists = await indexer.indexExists();
      let chunkCount = 0;
      let lastUpdated = null;
      
      if (exists) {
        const stats = await indexer.getStats();
        chunkCount = stats.totalChunks || 0;
        lastUpdated = stats.lastUpdated || null;
      }
      
      res.json({
        exists,
        chunkCount,
        lastUpdated
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/index/build', async (req, res) => {
    try {
      const indexer = await getIndexer();
      const result = await indexer.buildIndex({ force: req.body?.force });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/index/clean', async (req, res) => {
    try {
      const indexer = await getIndexer();
      await indexer.clean();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Semantic Search API
  let searcher = null;
  let searcherInitPromise = null;

  async function getSearcher(forceReinit = false) {
    if (forceReinit) {
      searcher = null;
      searcherInitPromise = null;
    }
    
    if (searcher?.initialized && !forceReinit) return searcher;
    if (searcherInitPromise && !forceReinit) return searcherInitPromise;
    
    searcherInitPromise = (async () => {
      try {
        searcher = new Searcher();
        await searcher.initialize(forceReinit);
        return searcher;
      } catch (err) {
        console.warn('[oc ui] Semantic search init failed:', err.message);
        searcher = null;
        searcherInitPromise = null;
        throw err;
      }
    })();
    
    return searcherInitPromise;
  }

  app.get('/api/semantic-search', async (req, res) => {
    try {
      const query = req.query.q || '';
      const limit = Number(req.query.limit) || 10;
      const mode = req.query.mode || 'hybrid'; // hybrid | vector | keyword
      const aggregateBy = req.query.aggregateBy || 'doc'; // content | doc | folder
      const docType = req.query.docType || req.query.doc_type || undefined;

      if (!query.trim()) {
        return res.json({ results: [], query, mode, aggregate_by: aggregateBy });
      }

      let searchEngine;
      try {
        searchEngine = await getSearcher();
      } catch (initErr) {
        // If init fails, return with indexMissing hint
        return res.json({ 
          results: [], 
          query,
          error: 'Search index not built. Run "oc index build" first.',
          indexMissing: true
        });
      }

      let results;
      try {
        results = await searchEngine.search(query, { limit, mode, aggregateBy, docType });
      } catch (searchErr) {
        // If search fails (e.g., stale connection), try reinitializing once
        if (searchErr.message && searchErr.message.includes('lance error')) {
          console.log('[oc ui] Search error, trying to reinitialize...');
          try {
            searchEngine = await getSearcher(true); // Force reinit
            results = await searchEngine.search(query, { limit, mode, aggregateBy, docType });
          } catch (retryErr) {
            throw retryErr;
          }
        } else {
          throw searchErr;
        }
      }
      
      res.json({
        query,
        mode,
        aggregate_by: aggregateBy,
        count: results.length,
        results: results.map(r => ({
          score: r.score,
          file_path: r.filePath,
          heading_path: r.headingPath || '',
          section_title: r.sectionTitle || '',
          line_start: r.lineStart,
          line_end: r.lineEnd,
          content: r.content,
          matched_by: r.matchedBy || r.source,
          hit_count: r.hitCount,
          doc_count: r.docCount,
          display_name: r.displayName,
          folder_path: r.folderPath,
          doc_type: r.docType || r.doc_type,
          entry_id: r.entryId || r.entry_id,
          entry_date: r.entryDate || r.entry_date,
          entry_created_at: r.entryCreatedAt || r.entry_created_at,
          idea_box: r.ideaBox || r.idea_box
        }))
      });
    } catch (error) {
      const msg = error.message || 'Search failed';
      // If index not found, return empty results with hint
      if (msg.includes('index not found') || msg.includes('not found')) {
        return res.json({ 
          results: [], 
          query: req.query.q || '',
          error: 'Search index not built. Run "oc index build" first.',
          indexMissing: true
        });
      }
      res.status(500).json({ error: msg });
    }
  });

  const distPath = path.resolve(__dirname, '../../dist/ui');
  if (!fs.existsSync(distPath)) {
    console.warn('[oc ui] UI assets not found. Have you run "npm run ui:build"?');
  }
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = {
  createUiServer
};
