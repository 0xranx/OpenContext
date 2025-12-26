/**
 * OpenContext API 抽象层
 * - 在 Tauri 桌面环境中使用 invoke 调用 Rust core
 * - 在 Web 环境中回退到 HTTP API
 */

const API_BASE = import.meta.env?.VITE_API_BASE ?? '';

// 检测是否在 Tauri 环境中
const TAURI_GLOBAL_KEYS = ['__TAURI__', '__TAURI_IPC__', '__TAURI_METADATA__', '__TAURI_INTERNALS__'];

const hasTauriRuntime = () => {
  if (typeof window !== 'undefined') {
    if (TAURI_GLOBAL_KEYS.some((key) => key in window)) return true;
    if (typeof navigator !== 'undefined' && navigator.userAgent?.includes('Tauri')) return true;
  }
  return Boolean(import.meta.env?.TAURI_PLATFORM);
};

const waitForTauriRuntime = async (timeoutMs = 1500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (hasTauriRuntime()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return hasTauriRuntime();
};

let tauriInvoke = null;
let loadInvokePromise = null;

async function loadInvoke() {
  if (typeof window !== 'undefined') {
    const directInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (directInvoke) {
      tauriInvoke = directInvoke;
      return tauriInvoke;
    }
  }
  const runtimeReady = await waitForTauriRuntime();
  if (!runtimeReady) return null;
  try {
    const tauri = await import('@tauri-apps/api/core');
    tauriInvoke = tauri.invoke;
    return tauriInvoke;
  } catch (e) {
    console.warn('Failed to load @tauri-apps/api, falling back to HTTP:', e);
    return null;
  } finally {
    loadInvokePromise = null;
  }
}

async function getInvoke() {
  if (tauriInvoke) return tauriInvoke;
  if (!loadInvokePromise) {
    loadInvokePromise = loadInvoke();
  }
  return loadInvokePromise;
}

// HTTP fetch 辅助函数
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

// ===== Folder API =====

export async function listFolders(options = {}) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('list_folders', { options: { all: options.all || false } });
  }
  const params = options.all ? '?all=true' : '';
  return fetchJSON(`${API_BASE}/api/folders${params}`);
}

export async function createFolder(path, description) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('create_folder', { options: { path, description } });
  }
  return fetchJSON(`${API_BASE}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, description }),
  });
}

export async function renameFolder(path, newName) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('rename_folder', { options: { path, newName } });
  }
  return fetchJSON(`${API_BASE}/api/folders/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, new_name: newName }),
  });
}

export async function moveFolder(path, destFolderPath) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('move_folder', { options: { path, destFolderPath } });
  }
  return fetchJSON(`${API_BASE}/api/folders/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, dest_folder_path: destFolderPath }),
  });
}

export async function removeFolder(path, force = false) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('remove_folder', { options: { path, force } });
  }
  return fetchJSON(`${API_BASE}/api/folders/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, force }),
  });
}

// ===== Document API =====

export async function listDocs(folderPath, recursive = false) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('list_docs', { options: { folderPath, recursive } });
  }
  const params = new URLSearchParams({ folder: folderPath });
  if (recursive) params.set('recursive', 'true');
  return fetchJSON(`${API_BASE}/api/docs?${params}`);
}

export async function createDoc(folderPath, name, description) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('create_doc', { options: { folderPath, name, description } });
  }
  return fetchJSON(`${API_BASE}/api/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_path: folderPath, name, description }),
  });
}

export async function moveDoc(docPath, destFolderPath) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('move_doc', { options: { docPath, destFolderPath } });
  }
  return fetchJSON(`${API_BASE}/api/docs/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_path: docPath, dest_folder_path: destFolderPath }),
  });
}

export async function renameDoc(docPath, newName) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('rename_doc', { options: { docPath, newName } });
  }
  return fetchJSON(`${API_BASE}/api/docs/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_path: docPath, new_name: newName }),
  });
}

export async function removeDoc(docPath) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('remove_doc', { options: { docPath } });
  }
  return fetchJSON(`${API_BASE}/api/docs/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: docPath }),
  });
}

export async function setDocDescription(docPath, description) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('set_doc_description', { options: { docPath, description } });
  }
  return fetchJSON(`${API_BASE}/api/docs/description`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_path: docPath, description }),
  });
}

export async function getDocContent(path) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('get_doc_content', { options: { path } });
  }
  return fetchJSON(`${API_BASE}/api/docs/content?path=${encodeURIComponent(path)}`);
}

export async function getDocMeta(path) {
  if (!path) throw new Error('Missing doc path');
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('get_doc_meta', { options: { path } });
    } catch (e) {
      console.warn('get_doc_meta not available in Tauri, falling back to HTTP:', e);
    }
  }
  return fetchJSON(`${API_BASE}/api/docs/meta?path=${encodeURIComponent(path)}`);
}

export async function getDocById(stableId) {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('get_doc_by_id', { options: { stableId } });
    } catch (e) {
      console.warn('get_doc_by_id not available in Tauri, falling back to HTTP:', e);
    }
  }
  return fetchJSON(`${API_BASE}/api/docs/by-id/${encodeURIComponent(stableId)}`);
}

export async function searchDocs(query, limit = 50) {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('search_docs', { options: { query, limit } });
    } catch (e) {
      console.warn('search_docs not available in Tauri, falling back to HTTP:', e);
    }
  }
  const params = new URLSearchParams({ q: query || '' });
  if (limit) params.set('limit', String(limit));
  return fetchJSON(`${API_BASE}/api/docs/search?${params}`);
}

export async function saveDocContent(path, content, description) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('save_doc_content', { options: { path, content, description } });
  }
  return fetchJSON(`${API_BASE}/api/docs/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, description }),
  });
}

// ===== Index API =====

export async function buildSearchIndex() {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('build_search_index');
  }
  return fetchJSON(`${API_BASE}/api/index/build`, { method: 'POST' });
}

export async function getIndexStatus() {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('get_index_status');
  }
  return fetchJSON(`${API_BASE}/api/index/status`);
}

export async function cleanSearchIndex() {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('clean_search_index');
  }
  return fetchJSON(`${API_BASE}/api/index/clean`, { method: 'POST' });
}

// ===== Utility API =====

export async function generateManifest(folderPath, limit) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('generate_manifest', { options: { folderPath, limit } });
  }
  const params = new URLSearchParams({ folder: folderPath });
  if (limit) params.set('limit', String(limit));
  return fetchJSON(`${API_BASE}/api/manifest?${params}`);
}

export async function getEnvInfo() {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('get_env_info');
  }
  return fetchJSON(`${API_BASE}/api/env`);
}

/**
 * Save configuration to config.json
 * @param {Object} options - Config options to save
 * @param {string} options.apiKey - OpenAI API key
 * @param {string} options.apiBase - API base URL
 * @param {string} options.model - Embedding model name
 */
export async function saveConfig(options) {
  const invoke = await getInvoke();
  if (invoke) {
    return invoke('save_config', { options });
  }
  return fetchJSON(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
}

// ===== AI API =====

/**
 * Get AI configuration
 * @returns {Promise<{provider: string, model: string, api_base: string, has_api_key: boolean, prompt: string, default_prompt: string}>}
 */
export async function getAIConfig() {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('get_ai_config');
    } catch (e) {
      console.warn('get_ai_config not available in Tauri, falling back to HTTP:', e);
    }
  }
  return fetchJSON(`${API_BASE}/api/ai/config`);
}

/**
 * Save AI configuration
 * @param {Object} options - AI config options
 * @param {string} options.provider - AI provider (openai | ollama)
 * @param {string} options.apiKey - AI API key
 * @param {string} options.apiBase - AI API base URL
 * @param {string} options.model - AI model name
 * @param {string} options.prompt - Custom system prompt
 */
export async function saveAIConfig(options) {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('save_ai_config', { options });
    } catch (e) {
      console.warn('save_ai_config not available in Tauri, falling back to HTTP:', e);
    }
  }
  return fetchJSON(`${API_BASE}/api/ai/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
}

/**
 * Stream AI chat completion
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {function(string): void} onToken - Callback for each token
 * @param {function(Error): void} onError - Error callback
 * @returns {Promise<void>}
 */
export async function streamAIChat(messages, onToken, onError) {
  const invoke = await getInvoke();
  
  // Use Tauri events for streaming if available
  if (invoke) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      
      // 为每个请求生成唯一 ID，避免并行请求冲突
      const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const eventName = `ai-stream-${requestId}`;
      
      return new Promise((resolve, reject) => {
        let unlisten = null;
        let resolved = false;
        
        // Set up event listener for streaming
        listen(eventName, (event) => {
          const { content, done, error } = event.payload;
          
          if (error) {
            if (!resolved) {
              resolved = true;
              try {
                onError?.(new Error(error));
              } catch (err) {
                // ignore handler errors to avoid swallowing rejection
              }
              if (unlisten) unlisten();
              reject(new Error(error));
            }
            return;
          }
          
          if (content) {
            onToken?.(content);
          }
          
          if (done) {
            if (!resolved) {
              resolved = true;
              if (unlisten) unlisten();
              resolve();
            }
          }
        }).then((unlistenFn) => {
          unlisten = unlistenFn;
          
          // Invoke the AI chat command with request ID
          invoke('ai_chat', { options: { messages, requestId } }).catch((e) => {
            if (!resolved) {
              resolved = true;
              onError?.(e);
              if (unlisten) unlisten();
              reject(e);
            }
          });
        }).catch((e) => {
          onError?.(e);
          reject(e);
        });
      });
    } catch (e) {
      console.warn('Tauri AI chat not available, falling back to HTTP:', e);
    }
  }
  
  // Fallback to HTTP SSE
  try {
    const response = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
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
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) {
              const err = new Error(data.error);
              onError?.(err);
              throw err;
            }
            if (data.content) {
              onToken?.(data.content);
            }
            if (data.done) {
              return;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } catch (error) {
    onError?.(error);
    throw error;
  }
}

// ===== Semantic Search API =====

/**
 * Execute semantic search
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @param {number} options.limit - Max results (default 10)
 * @param {string} options.mode - Search mode: 'hybrid' | 'vector' | 'keyword' (default 'hybrid')
 * @param {string} options.aggregateBy - Aggregation: 'content' | 'doc' | 'folder' (default 'doc')
 * @returns {Promise<{query: string, results: Array, count: number, error?: string, indexMissing?: boolean}>}
 */
export async function semanticSearch(query, options = {}) {
  const { limit = 10, mode = 'hybrid', aggregateBy = 'doc', docType } = options;
  
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('semantic_search', { 
        options: { query, limit, mode, aggregateBy, docType } 
      });
    } catch (e) {
      console.warn('semantic_search not available in Tauri, falling back to HTTP:', e);
    }
  }
  
  const params = new URLSearchParams({ 
    q: query, 
    limit: String(limit),
    mode,
    aggregateBy
  });
  if (docType) params.set('docType', String(docType));
  return fetchJSON(`${API_BASE}/api/semantic-search?${params}`);
}
