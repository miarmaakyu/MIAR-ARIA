const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miar', {
  // AI
  sendMessage: (payload) => ipcRenderer.invoke('ai:send-message', payload),
  testKey: (payload) => ipcRenderer.invoke('ai:test-key', payload),

  // Storage
  getSettings: () => ipcRenderer.invoke('storage:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('storage:save-settings', settings),
  getConversations: () => ipcRenderer.invoke('storage:get-conversations'),
  getConversation: (id) => ipcRenderer.invoke('storage:get-conversation', id),
  createConversation: (title) => ipcRenderer.invoke('storage:create-conversation', title),
  saveMessage: (payload) => ipcRenderer.invoke('storage:save-message', payload),
  updateConversationTitle: (payload) => ipcRenderer.invoke('storage:update-conversation-title', payload),
  deleteConversation: (id) => ipcRenderer.invoke('storage:delete-conversation', id),
  searchConversations: (query) => ipcRenderer.invoke('storage:search-conversations', query),
  getLastConversationId: () => ipcRenderer.invoke('storage:get-last-conversation-id'),
  setLastConversationId: (id) => ipcRenderer.invoke('storage:set-last-conversation-id', id),

  // Files
  selectFiles: () => ipcRenderer.invoke('file:select-files'),
  selectFolder: () => ipcRenderer.invoke('file:select-folder'),
  readFolderFile: (path) => ipcRenderer.invoke('file:read-folder-file', path),

  // Maintenance
  getAppStructure: () => ipcRenderer.invoke('maintenance:get-app-structure'),
  createBackup: () => ipcRenderer.invoke('maintenance:create-backup'),
  getLogs: () => ipcRenderer.invoke('maintenance:get-logs'),
});
