// ============================================================
// ShadowForge — Shared Constants
// ============================================================

export const TRUEFORGE_DEFAULT_URL = 'http://localhost:8790';
export const MCP_DEFAULT_PORT = 3001;
export const MCP_HOST = '127.0.0.1';

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 32_000;
export const TOKENS_PER_LINE_ESTIMATE = 10; // rough estimate for budget packing

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 30_000;
export const STALL_TIMEOUT_MS = 30_000; // 30s without token = stalled

export const ALLOWED_COMMANDS = ['python', 'python3', 'pytest', 'pip', 'git', 'npm', 'node'];
export const COMMAND_TIMEOUT_MS = 60_000;

export const SENSITIVE_KEY_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /KEY/i,
];

// File patterns to ignore during indexing
export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/.venv/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/out/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.svg',
  '**/*.ico',
  '**/*.pdf',
  '**/*.zip',
  '**/*.tar.gz',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
];

// Language detection by extension
export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.md': 'markdown',
  '.rst': 'restructuredtext',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
};

// Max file size to index (bytes)
export const MAX_INDEX_FILE_SIZE = 500_000; // 500 KB

// Webview panel IDs
export const CHAT_PANEL_ID = 'shadowforge.chatPanel';
export const CONTEXT_LEDGER_PANEL_ID = 'shadowforge.contextLedger';

// Storage keys
export const STORAGE_KEY_UNDO_HISTORY = 'shadowforge.undoHistory';
export const STORAGE_KEY_SESSION_ID = 'shadowforge.sessionId';

