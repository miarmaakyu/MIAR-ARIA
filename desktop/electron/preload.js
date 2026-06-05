const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miar', {
  // AI
  sendMessage: (p) => ipcRenderer.invoke('ai:send-message', p),
  testKey: (p) => ipcRenderer.invoke('ai:test-key', p),
  getKeyStatus: () => ipcRenderer.invoke('ai:get-key-status'),

  // Storage
  getSettings: () => ipcRenderer.invoke('storage:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('storage:save-settings', s),
  getConversations: () => ipcRenderer.invoke('storage:get-conversations'),
  getConversation: (id) => ipcRenderer.invoke('storage:get-conversation', id),
  createConversation: (title) => ipcRenderer.invoke('storage:create-conversation', title),
  saveMessage: (p) => ipcRenderer.invoke('storage:save-message', p),
  updateConversationTitle: (p) => ipcRenderer.invoke('storage:update-conversation-title', p),
  deleteConversation: (id) => ipcRenderer.invoke('storage:delete-conversation', id),
  searchConversations: (q) => ipcRenderer.invoke('storage:search-conversations', q),
  getLastConversationId: () => ipcRenderer.invoke('storage:get-last-conversation-id'),
  setLastConversationId: (id) => ipcRenderer.invoke('storage:set-last-conversation-id', id),

  // Memory
  memoryAdd: (p) => ipcRenderer.invoke('memory:add', p),
  memoryGet: (p) => ipcRenderer.invoke('memory:get', p),
  memorySearch: (q) => ipcRenderer.invoke('memory:search', q),
  memoryUpdate: (p) => ipcRenderer.invoke('memory:update', p),
  memoryDelete: (id) => ipcRenderer.invoke('memory:delete', id),
  memoryClearAll: () => ipcRenderer.invoke('memory:clear-all'),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),
  memoryExtract: (p) => ipcRenderer.invoke('memory:extract', p),

  // Files
  selectFiles: () => ipcRenderer.invoke('file:select-files'),
  selectFolder: () => ipcRenderer.invoke('file:select-folder'),
  readFolderFile: (fp) => ipcRenderer.invoke('file:read-folder-file', fp),

  // Maintenance
  getAppStructure: () => ipcRenderer.invoke('maintenance:get-app-structure'),
  createBackup: () => ipcRenderer.invoke('maintenance:create-backup'),
  getLogs: () => ipcRenderer.invoke('maintenance:get-logs'),

  // System — acesso total ao Windows
  runCommand: (cmd) => ipcRenderer.invoke('system:run-command', cmd),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
});
