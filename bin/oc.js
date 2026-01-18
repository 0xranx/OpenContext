#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const { spawnSync } = require('child_process');
const store = require('../src/core/store/index.js');
const config = require('../src/core/config');
const { syncAgentsArtifacts } = require('../src/core/agents');
const { startServer: startMcpServer } = require('../src/mcp/server');
const { createUiServer } = require('../src/ui/server');
const { Indexer, Searcher } = require('../src/core/search');

const program = new Command();
program.name('oc').description('OpenContext CLI').showHelpAfterError();

function mdEscapeCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  // Minimal escaping for markdown table cells
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function truncate(str, max = 140) {
  const s = str === undefined || str === null ? '' : String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildPathTree(relPaths) {
  const root = { type: 'dir', name: '', children: new Map() };
  for (const relPath of relPaths) {
    const parts = String(relPath).split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, idx) => {
      const isFile = idx === parts.length - 1;
      const key = `${isFile ? 'f' : 'd'}:${part}`;
      if (!node.children.has(key)) {
        node.children.set(key, {
          type: isFile ? 'file' : 'dir',
          name: part,
          children: isFile ? null : new Map()
        });
      }
      node = node.children.get(key);
    });
  }
  return root;
}

function renderTreeMarkdown(tree, { fileMetaByRelPath }) {
  const lines = [];
  function walk(node, depth) {
    if (!node.children) return;
    const entries = Array.from(node.children.values()).sort((a, b) => {
      // dirs first, then files; then name
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of entries) {
      const indent = '  '.repeat(depth);
      if (child.type === 'dir') {
        lines.push(`${indent}- ${child.name}/`);
        walk(child, depth + 1);
      } else {
        const meta = fileMetaByRelPath.get(child.__rel_path || '') || null;
        // Note: __rel_path is filled by caller for file nodes if needed; fallback to name only.
        const desc = meta && meta.description ? ` — ${truncate(meta.description, 120)}` : '';
        lines.push(`${indent}- ${child.name}${desc}`);
      }
    }
  }
  walk(tree, 0);
  return lines.join('\n');
}

function renderManifestLlm({ folderPath, limit, rows }) {
  const effectiveFolder = folderPath && String(folderPath).trim() ? String(folderPath).trim() : '.';
  const fileMetaByRelPath = new Map();
  for (const r of rows) {
    fileMetaByRelPath.set(r.rel_path, r);
  }

  // Build tree, but we also want per-file rel_path to be reachable in file nodes for description lookup.
  // Simplest: build tree from rel_paths, then during rendering look up by accumulating paths.
  const root = { type: 'dir', name: '', children: new Map() };
  for (const relPath of rows.map((r) => r.rel_path)) {
    const parts = String(relPath).split('/').filter(Boolean);
    let node = root;
    let acc = [];
    parts.forEach((part, idx) => {
      acc.push(part);
      const isFile = idx === parts.length - 1;
      const key = `${isFile ? 'f' : 'd'}:${part}`;
      if (!node.children.has(key)) {
        node.children.set(key, {
          type: isFile ? 'file' : 'dir',
          name: part,
          children: isFile ? null : new Map(),
          __rel_path: isFile ? acc.join('/') : undefined
        });
      }
      node = node.children.get(key);
    });
  }

  const lines = [];
  lines.push('# OpenContext Manifest (LLM-friendly)');
  lines.push('');
  lines.push(`- folder: \`${effectiveFolder}\``);
  lines.push(`- count: ${rows.length}${limit ? ` (limit=${limit})` : ''}`);
  lines.push('');
  lines.push('## Tree');
  lines.push('');
  lines.push(renderTreeMarkdown(root, { fileMetaByRelPath }) || '(no docs)');
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('| rel_path | description | stable_link | abs_path | updated_at |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const stableLink = r.stable_id ? `oc://doc/${r.stable_id}` : '';
    lines.push(
      `| \`${mdEscapeCell(r.rel_path)}\` | ${mdEscapeCell(truncate(r.description || '', 160))} | \`${mdEscapeCell(
        stableLink
      )}\` | \`${mdEscapeCell(r.abs_path)}\` | \`${mdEscapeCell(r.updated_at || '')}\` |`
    );
  }
  lines.push('');
  lines.push('## Next steps (recommended)');
  lines.push('');
  lines.push('- Pick 1–5 candidate files, then load them by `abs_path` (e.g., in Cursor: `read_file(abs_path)`).');
  lines.push('- When citing docs, prefer `stable_link` (`oc://doc/<stable_id>`) if present.');
  return lines.join('\n');
}

function handle(action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  };
}

function openInEditor(filePath) {
  const editor = process.env.EDITOR || 'vi';
  const result = spawnSync(editor, [filePath], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to open editor: ${result.error.message}`);
  }
}

const TOOL_LABELS = {
  cursor: 'Cursor',
  claude: 'Claude Code',
  codex: 'Codex'
};
const TOOL_ALIASES = {
  '1': 'cursor',
  '2': 'claude',
  '3': 'codex',
  cursor: 'cursor',
  claude: 'claude',
  'claude-code': 'claude',
  'claude_code': 'claude',
  codex: 'codex'
};
const DEFAULT_TOOL_SELECTION = {
  cursor: true,
  claude: true,
  codex: true
};

function parseToolSelection(input) {
  const tokens = String(input || '')
    .split(/[, ]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { selection: { ...DEFAULT_TOOL_SELECTION }, unknown: [] };
  }

  if (tokens.includes('all')) {
    return { selection: { ...DEFAULT_TOOL_SELECTION }, unknown: [] };
  }

  if (tokens.includes('none')) {
    return { selection: { cursor: false, claude: false, codex: false }, unknown: [] };
  }

  const selection = { cursor: false, claude: false, codex: false };
  const unknown = [];

  tokens.forEach((token) => {
    const key = TOOL_ALIASES[token];
    if (!key) {
      unknown.push(token);
      return;
    }
    selection[key] = true;
  });

  return { selection, unknown };
}

function applyToolFlags(selection, options) {
  const result = { ...selection };
  if (options.cursor === false) result.cursor = false;
  if (options.claude === false) result.claude = false;
  if (options.codex === false) result.codex = false;
  return result;
}

function summarizeSelection(selection) {
  return Object.keys(TOOL_LABELS)
    .filter((key) => selection[key])
    .map((key) => TOOL_LABELS[key]);
}

async function promptForToolSelection() {
  const readline = require('readline');
  const prompt =
    'Select tools to configure (1=Cursor, 2=Claude Code, 3=Codex; default: all): ';
  while (true) {
    const answer = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (input) => {
        rl.close();
        resolve(input);
      });
    });
    if (!String(answer || '').trim()) {
      return { ...DEFAULT_TOOL_SELECTION };
    }
    const parsed = parseToolSelection(answer);
    if (parsed.unknown.length === 0) {
      return parsed.selection;
    }
    console.log(`Invalid selection: ${parsed.unknown.join(', ')}. Try again.`);
  }
}

async function resolveToolSelection(options) {
  let selection = { ...DEFAULT_TOOL_SELECTION };
  let hasExplicit = false;

  if (options.tools) {
    const parsed = parseToolSelection(options.tools);
    if (parsed.unknown.length > 0) {
      throw new Error(`Invalid --tools entries: ${parsed.unknown.join(', ')}`);
    }
    selection = parsed.selection;
    hasExplicit = true;
  }

  if (options.cursor === false || options.claude === false || options.codex === false) {
    selection = applyToolFlags(selection, options);
    hasExplicit = true;
  }

  if (hasExplicit) {
    return selection;
  }

  if (!process.stdin.isTTY || process.env.CI) {
    return selection;
  }

  return promptForToolSelection();
}

program
  .command('init')
  .description('Initialize contexts directory and database')
  .option('--tools <list>', 'Tools to configure (cursor, claude, codex; default: all)')
  .option('--no-cursor', 'Skip Cursor setup')
  .option('--no-claude', 'Skip Claude Code setup')
  .option('--no-codex', 'Skip Codex setup')
  .action(
    handle(async (options) => {
      const info = store.initEnvironment();
      console.log(`Contexts directory ready at ${info.contextsRoot}`);
      console.log(`Database ready at ${info.dbPath}`);
      const projectRoot = process.cwd();
      const tools = await resolveToolSelection(options);
      const selected = summarizeSelection(tools);
      if (selected.length === 0) {
        console.log('No tool configuration selected; skipping slash commands and MCP config.');
      } else {
        console.log(`Tool setup: ${selected.join(', ')}`);
      }
      const outputs = syncAgentsArtifacts(projectRoot, { tools });
      if (outputs.length) {
        outputs.forEach((file) => console.log(`Synced instructions: ${file}`));
      }
    })
  );

const folderCmd = program.command('folder').description('Folder operations');

folderCmd
  .command('ls')
  .option('--all', 'List all levels')
  .description('List folders')
  .action(
    handle((options) => {
      const rows = store.listFolders({ all: options.all });
      if (rows.length === 0) {
        console.log('(no folders)');
        return;
      }
      rows.forEach((row) => {
        const prefix = row.rel_path;
        const desc = row.description ? ` — ${row.description}` : '';
        console.log(`${prefix}${desc}`);
      });
    })
  );

folderCmd
  .command('create')
  .argument('<path>', 'Folder path relative to contexts/')
  .option('-d, --desc <desc>', 'Folder description')
  .description('Create a folder')
  .action(
    handle((pathArg, options) => {
      const result = store.createFolder({ path: pathArg, description: options.desc || '' });
      console.log(`Folder ready at "${result.rel_path}".`);
    })
  );

folderCmd
  .command('rename')
  .argument('<old_path>', 'Existing folder path')
  .argument('<new_name>', 'New folder name (single segment)')
  .description('Rename a folder')
  .action(
    handle((oldPath, newName) => {
      const result = store.renameFolder({ path: oldPath, newName });
      console.log(`Renamed folder "${result.old_path}" → "${result.new_path}".`);
    })
  );

folderCmd
  .command('rm')
  .argument('<path>', 'Folder path to remove')
  .option('-f, --force', 'Remove recursively')
  .description('Remove a folder')
  .action(
    handle((pathArg, options) => {
      const result = store.removeFolder({ path: pathArg, force: Boolean(options.force) });
      console.log(`Removed folder "${result.removed}".`);
    })
  );

const docCmd = program.command('doc').description('Document operations');

docCmd
  .command('ls')
  .argument('<folder_path>', 'Folder path whose docs to list')
  .option('-r, --recursive', 'List docs recursively')
  .description('List documents in a folder')
  .action(
    handle((folderPath, options) => {
      const rows = store.listDocs({ folderPath, recursive: Boolean(options.recursive) });
      if (rows.length === 0) {
        console.log('(no docs)');
        return;
      }
      rows.forEach((row) => {
        console.log(`${row.rel_path}${row.description ? ` — ${row.description}` : ''}`);
      });
    })
  );

docCmd
  .command('create')
  .argument('<folder_path>', 'Folder path to place the document in')
  .argument('<name>', 'Document file name')
  .option('-d, --desc <desc>', 'Document description')
  .option('--open', 'Open the file in $EDITOR after creation')
  .description('Create a new document')
  .action(
    handle((folderPath, name, options) => {
      const result = store.createDoc({ folderPath, name, description: options.desc || '' });
      console.log(`Created doc "${result.rel_path}".`);
      if (options.open) {
        openInEditor(result.abs_path);
      }
    })
  );

docCmd
  .command('mv')
  .argument('<doc_path>', 'Existing document path')
  .argument('<dest_folder_path>', 'Destination folder path')
  .description('Move a document to another folder')
  .action(
    handle((docPath, destFolderPath) => {
      const result = store.moveDoc({ docPath, destFolderPath });
      console.log(`Moved doc "${result.old_path}" → "${result.new_path}".`);
    })
  );

docCmd
  .command('rename')
  .argument('<doc_path>', 'Existing document path')
  .argument('<new_name>', 'New document name')
  .description('Rename a document')
  .action(
    handle((docPath, newName) => {
      const result = store.renameDoc({ docPath, newName });
      console.log(`Renamed doc "${result.old_path}" → "${result.new_path}".`);
    })
  );

docCmd
  .command('rm')
  .argument('<doc_path>', 'Document path to delete')
  .description('Delete a document')
  .action(
    handle((docPath) => {
      const result = store.removeDoc({ docPath });
      console.log(`Deleted doc "${result.removed}".`);
    })
  );

docCmd
  .command('set-desc')
  .argument('<doc_path>', 'Document path to update')
  .argument('<description>', 'Description text')
  .description('Update a document description')
  .action(
    handle((docPath, desc) => {
      const result = store.setDocDescription({ docPath, description: desc });
      console.log(`Updated description for "${result.rel_path}".`);
    })
  );

docCmd
  .command('id')
  .argument('<doc_path>', 'Existing document path')
  .description('Print stable_id (UUID) for a document')
  .action(
    handle((docPath) => {
      const doc = store.getDocMeta({ docPath });
      if (!doc.stable_id) {
        throw new Error('stable_id not found (schema migration may not have run yet). Run `oc init` and retry.');
      }
      console.log(doc.stable_id);
    })
  );

docCmd
  .command('resolve')
  .argument('<stable_id>', 'Document stable_id (UUID)')
  .description('Resolve stable_id to current document path/meta')
  .action(
    handle((stableId) => {
      const doc = store.getDocByStableId(stableId);
      console.log(
        JSON.stringify(
          {
            stable_id: doc.stable_id,
            rel_path: doc.rel_path,
            abs_path: doc.abs_path,
            description: doc.description || '',
            updated_at: doc.updated_at
          },
          null,
          2
        )
      );
    })
  );

docCmd
  .command('link')
  .argument('<doc_path>', 'Existing document path')
  .option('--label <label>', 'Label to display in markdown link')
  .description('Generate a stable markdown link to a document')
  .action(
    handle((docPath, options) => {
      const doc = store.getDocMeta({ docPath });
      if (!doc.stable_id) {
        throw new Error('stable_id not found (schema migration may not have run yet). Run `oc init` and retry.');
      }
      const label =
        options.label ||
        path
          .basename(doc.rel_path)
          .replace(/\.md$/i, '');
      const url = `oc://doc/${doc.stable_id}`;
      console.log(`[${label}](${url})`);
    })
  );

docCmd
  .command('open')
  .argument('<stable_id>', 'Document stable_id (UUID)')
  .description('Open a document by stable_id in $EDITOR')
  .action(
    handle((stableId) => {
      const doc = store.getDocByStableId(stableId);
      openInEditor(doc.abs_path);
    })
  );

program
  .command('context')
  .description('Context utilities')
  .command('manifest')
  .argument('[folder_path]', 'Folder path to emit manifest for (use "." for root/all)')
  .option('-l, --limit <number>', 'Limit number of docs')
  .option('-f, --format <format>', 'Output format: json (default) | llm')
  .option('--llm', 'Shortcut for --format llm')
  .description('Output a manifest of docs under a folder')
  .action(
    handle((folderPath, options) => {
      const effectiveFolder = folderPath === undefined ? '.' : folderPath;
      const limit = options.limit !== undefined ? Number(options.limit) : null;
      const rows = store.generateManifest({ folderPath: effectiveFolder, limit });
      const format = options.llm ? 'llm' : (options.format || 'json');
      if (format === 'json') {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (format === 'llm') {
        console.log(renderManifestLlm({ folderPath: effectiveFolder, limit, rows }));
        return;
      }
      throw new Error(`Unknown format "${format}". Supported: json, llm`);
    })
  );

// ===== Config commands =====
const configCmd = program.command('config').description('Configuration management');

configCmd
  .command('set')
  .argument('<key>', 'Configuration key')
  .argument('<value>', 'Configuration value')
  .description('Set a configuration value')
  .action(
    handle((key, value) => {
      config.set(key, value);
      console.log(`✅ Set ${key}`);
    })
  );

configCmd
  .command('get')
  .argument('<key>', 'Configuration key')
  .description('Get a configuration value')
  .action(
    handle((key) => {
      const value = config.get(key);
      if (value === undefined) {
        console.log(`(not set)`);
      } else {
        // Mask sensitive info
        const keyInfo = config.CONFIG_KEYS[key];
        if (keyInfo?.sensitive) {
          const masked = value.length > 8 
            ? `${value.substring(0, 4)}••••••••${value.substring(value.length - 4)}`
            : '********';
          console.log(masked);
        } else {
          console.log(value);
        }
      }
    })
  );

configCmd
  .command('unset')
  .argument('<key>', 'Configuration key')
  .description('Remove a configuration value')
  .action(
    handle((key) => {
      config.unset(key);
      console.log(`✅ Removed ${key}`);
    })
  );

configCmd
  .command('list')
  .alias('ls')
  .option('--show-values', 'Show actual values (sensitive values will be partially masked)')
  .description('List all configuration values')
  .action(
    handle((options) => {
      const items = config.list(options.showValues);
      
      console.log('OpenContext Configuration\n');
      console.log(`Config file: ${config.getConfigPath()}\n`);
      
      const maxKeyLen = Math.max(...items.map(i => i.key.length));
      
      for (const item of items) {
        const keyPad = item.key.padEnd(maxKeyLen);
        const status = item.isSet ? '✓' : '○';
        const source = item.source === 'env' ? '[env]' : item.source === 'config' ? '[config]' : '[default]';
        const value = item.value || '(not set)';
        
        console.log(`${status} ${keyPad}  ${value.padEnd(30)} ${source}`);
        console.log(`  ${item.description}\n`);
      }
    })
  );

configCmd
  .command('path')
  .description('Show configuration file path')
  .action(
    handle(() => {
      console.log(config.getConfigPath());
    })
  );

// ===== Index commands =====
const indexCmd = program.command('index').description('Search index operations');

indexCmd
  .command('build')
  .option('-f, --folder <folder>', 'Limit indexing to a specific folder')
  .option('--force', 'Force full rebuild (ignore incremental)')
  .description('Build search index for semantic search (supports incremental updates)')
  .action(
    handle(async (options) => {
      const indexer = new Indexer();
      
      const stats = await indexer.buildIndex({
        folder: options.folder,
        force: options.force,
        onProgress: (progress) => {
          if (progress.phase === 'start') {
            const modeLabel = progress.mode === 'full' ? 'Full rebuild' : 'Incremental update';
            console.log(`🔄 ${modeLabel}...`);
          } else if (progress.phase === 'scan') {
            console.log(`📄 Scanned ${progress.fileCount} documents`);
          } else if (progress.phase === 'detect') {
            console.log(`🔍 Changes: +${progress.added} added, ~${progress.modified} modified, -${progress.deleted} deleted, =${progress.unchanged} unchanged`);
          } else if (progress.phase === 'chunk') {
            console.log(`✂️  Split into ${progress.chunkCount} chunks`);
          } else if (progress.phase === 'embedding') {
            console.log(`🧠 Generating ${progress.total} embeddings...`);
          } else if (progress.phase === 'embedding_progress') {
            process.stdout.write(`\r   Processing batch ${progress.current}/${progress.total}...`);
          } else if (progress.phase === 'done') {
            if (progress.noChanges) {
              console.log('✅ No changes, index is up to date!');
            } else {
              process.stdout.write('\n');
              console.log('✅ Index build complete!');
            }
          }
        }
      });
      
      const modeLabel = stats.mode === 'full' ? 'Full' : 'Incremental';
      console.log(`\n📊 ${modeLabel} stats: ${stats.fileCount} files, ${stats.chunkCount} chunks`);
      if (stats.mode === 'incremental') {
        const c = stats.changes;
        console.log(`   Changes: +${c.added} added, ~${c.modified} modified, -${c.deleted} deleted`);
      }
    })
  );

indexCmd
  .command('status')
  .description('Show search index status')
  .action(
    handle(async () => {
      const indexer = new Indexer();
      await indexer.initialize();
      const exists = await indexer.indexExists();
      
      if (!exists) {
        console.log('❌ Search index not found. Run "oc index build" to create it.');
        return;
      }
      
      const stats = await indexer.getStats();
      console.log(`✅ Search index ready`);
      console.log(`📊 Indexed chunks: ${stats.totalChunks || 0}`);
      if (stats.lastUpdated) {
        const date = new Date(stats.lastUpdated);
        console.log(`🕐 Last updated: ${date.toLocaleString()}`);
      }
    })
  );

indexCmd
  .command('clean')
  .description('Clean/reset the search index completely')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(
    handle(async (options) => {
      if (!options.yes) {
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
          rl.question('⚠️  This will delete all search index data. Continue? (y/N) ', resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled.');
          return;
        }
      }

      console.log('🧹 Cleaning search index...');
      
      const indexer = new Indexer();
      await indexer.initialize();
      await indexer.clean();
      
      console.log('✅ Search index cleaned successfully.');
      console.log('   Run "oc index build" to rebuild the index.');
    })
  );

// ===== Search command =====
program
  .command('search')
  .argument('<query>', 'Search query')
  .option('-l, --limit <number>', 'Number of results to return', (v) => Number(v), 5)
  .option('-t, --type <type>', 'Aggregation type: content (default) | doc | folder', 'content')
  .option('-m, --mode <mode>', 'Search mode: hybrid (default) | vector | keyword', 'hybrid')
  .option('-d, --doc-type <type>', 'Document type filter: doc | idea', undefined)
  .option('-f, --format <format>', 'Output format: plain (default) | json', 'plain')
  .description('Search content with optional aggregation by document or folder')
  .action(
    handle(async (query, options) => {
      const validTypes = ['content', 'folder', 'doc'];
      if (!validTypes.includes(options.type)) {
        throw new Error(`Invalid type "${options.type}". Valid types: ${validTypes.join(', ')}`);
      }
      
      const validModes = ['hybrid', 'vector', 'keyword'];
      if (!validModes.includes(options.mode)) {
        throw new Error(`Invalid mode "${options.mode}". Valid modes: ${validModes.join(', ')}`);
      }
      if (options.docType && !['doc', 'idea'].includes(options.docType)) {
        throw new Error(`Invalid doc type "${options.docType}". Valid types: doc, idea`);
      }

      // Use Searcher with aggregation
      const searcher = new Searcher();
      const results = await searcher.search(query, { 
        limit: options.limit,
        mode: options.mode,
        aggregateBy: options.type,
        docType: options.docType
      });

      // Format output
      if (options.format === 'json') {
        const jsonOutput = searcher.formatResultsJson(query, results, {
          mode: options.mode,
          aggregateBy: options.type,
          docType: options.docType
        });
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        console.log(searcher.formatResultsPlain(query, results, {
          mode: options.mode,
          aggregateBy: options.type
        }));
      }
    })
  );


// ===== MCP command =====
program
  .command('mcp')
  .description('Start OpenContext MCP server (stdio)')
  .option('--test', 'Test mode (auto exit)')
  .action(
    handle(async (options) => {
      await startMcpServer({ autoExit: Boolean(options.test) });
    })
  );

program
  .command('ui')
  .description('Launch OpenContext web UI')
  .option('-p, --port <port>', 'Port to run on', (value) => Number(value), 4321)
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--no-open', 'Do not auto-open browser')
  .action(
    handle(async (options) => {
      ensureUiBundle();
      const server = await createUiServer({ host: options.host, port: options.port });
      const url = `http://${options.host}:${options.port}`;
      console.log(`OpenContext UI is running at ${url}`);
      if (options.open !== false) {
        await launchBrowser(url);
      }
      const shutdown = () => {
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
  );

program.parse(process.argv);

async function launchBrowser(url) {
  const mod = await import('open');
  return mod.default(url);
}

function ensureUiBundle() {
  const distIndex = path.resolve(__dirname, '../dist/ui/index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error(
      'UI bundle not found. Run "npm run ui:build" (or rely on the published package which ships dist/ui) before executing "oc ui".'
    );
  }
}
