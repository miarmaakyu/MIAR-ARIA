const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');

const aiHandler = require('./ai-handler');
const storageHandler = require('./storage-handler');
const fileHandler = require('./file-handler');
const maintenanceHandler = require('./maintenance-handler');
const memoryHandler = require('./memory-handler');
const systemHandler = require('./system-handler');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MIAR ÁRIA',
    backgroundColor: '#06101c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  storageHandler.init();
  memoryHandler.init();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── AI ───────────────────────────────────────────────────────────────────────

ipcMain.handle('ai:send-message', async (event, { messages, conversationId, attachments, memories }) => {
  const sysInfo = systemHandler.getSystemInfo();
  return await aiHandler.sendMessage(messages, conversationId, attachments, memories, sysInfo);
});

// ── SYSTEM / WINDOWS ──────────────────────────────────────────────────────────
ipcMain.handle('system:run-command', async (e, command) => {
  return await systemHandler.runCommand(command);
});
ipcMain.handle('system:get-info', async () => {
  return systemHandler.getSystemInfo();
});

ipcMain.handle('ai:test-key', async (event, { provider, key }) => {
  return await aiHandler.testKey(provider, key);
});

ipcMain.handle('ai:get-key-status', async () => {
  return aiHandler.getKeyStatus();
});

// ── STORAGE ──────────────────────────────────────────────────────────────────

ipcMain.handle('storage:get-settings', async () => storageHandler.getSettings());
ipcMain.handle('storage:save-settings', async (e, s) => storageHandler.saveSettings(s));
ipcMain.handle('storage:get-conversations', async () => storageHandler.getConversations());
ipcMain.handle('storage:get-conversation', async (e, id) => storageHandler.getConversation(id));
ipcMain.handle('storage:create-conversation', async (e, title) => storageHandler.createConversation(title));
ipcMain.handle('storage:save-message', async (e, p) => storageHandler.saveMessage(p.conversationId, p.role, p.content, p.attachments));
ipcMain.handle('storage:update-conversation-title', async (e, p) => storageHandler.updateConversationTitle(p.id, p.title));
ipcMain.handle('storage:delete-conversation', async (e, id) => storageHandler.deleteConversation(id));
ipcMain.handle('storage:search-conversations', async (e, q) => storageHandler.searchConversations(q));
ipcMain.handle('storage:get-last-conversation-id', async () => storageHandler.getLastConversationId());
ipcMain.handle('storage:set-last-conversation-id', async (e, id) => storageHandler.setLastConversationId(id));

// ── MEMORY ───────────────────────────────────────────────────────────────────

ipcMain.handle('memory:add', async (e, p) => memoryHandler.addMemory(p));
ipcMain.handle('memory:get', async (e, p) => memoryHandler.getMemories(p));
ipcMain.handle('memory:search', async (e, query) => memoryHandler.searchRelevantMemories(query));
ipcMain.handle('memory:update', async (e, p) => memoryHandler.updateMemory(p.id, p));
ipcMain.handle('memory:delete', async (e, id) => memoryHandler.deleteMemory(id));
ipcMain.handle('memory:clear-all', async () => memoryHandler.clearAll());
ipcMain.handle('memory:stats', async () => memoryHandler.getStats());
ipcMain.handle('memory:extract', async (e, { snippet }) => {
  const keys = storageHandler.getSettingsRaw().apiKeys || {};
  return await memoryHandler.extractAndSaveMemories(snippet, true, keys);
});

// ── FILES ────────────────────────────────────────────────────────────────────

ipcMain.handle('file:select-files', async () => {
  // Uso pessoal — todos os tipos, sem restrição
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (result.canceled) return { canceled: true, files: [] };
  const files = [];
  for (const fp of result.filePaths) files.push(await fileHandler.readFile(fp));
  return { canceled: false, files };
});

ipcMain.handle('file:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione uma pasta para autorizar acesso',
  });
  if (result.canceled) return { canceled: true };
  const folderPath = result.filePaths[0];
  return { canceled: false, folderPath, ...await fileHandler.listFolder(folderPath) };
});

ipcMain.handle('file:read-folder-file', async (e, fp) => fileHandler.readFile(fp));

// ── MAINTENANCE ──────────────────────────────────────────────────────────────

ipcMain.handle('maintenance:get-app-structure', async () => maintenanceHandler.getAppStructure());
ipcMain.handle('maintenance:create-backup', async () => maintenanceHandler.createBackup());
ipcMain.handle('maintenance:get-logs', async () => maintenanceHandler.getLogs());
