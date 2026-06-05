const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const aiHandler = require('./ai-handler');
const storageHandler = require('./storage-handler');
const fileHandler = require('./file-handler');
const maintenanceHandler = require('./maintenance-handler');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MIAR ÁRIA',
    backgroundColor: '#0f0f13',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  storageHandler.init();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── AI ──────────────────────────────────────────────────────────────────────

ipcMain.handle('ai:send-message', async (event, { messages, conversationId, attachments }) => {
  return await aiHandler.sendMessage(messages, conversationId, attachments);
});

ipcMain.handle('ai:test-key', async (event, { provider, key }) => {
  return await aiHandler.testKey(provider, key);
});

// ── STORAGE ─────────────────────────────────────────────────────────────────

ipcMain.handle('storage:get-settings', async () => {
  return storageHandler.getSettings();
});

ipcMain.handle('storage:save-settings', async (event, settings) => {
  return storageHandler.saveSettings(settings);
});

ipcMain.handle('storage:get-conversations', async () => {
  return storageHandler.getConversations();
});

ipcMain.handle('storage:get-conversation', async (event, id) => {
  return storageHandler.getConversation(id);
});

ipcMain.handle('storage:create-conversation', async (event, title) => {
  return storageHandler.createConversation(title);
});

ipcMain.handle('storage:save-message', async (event, { conversationId, role, content, attachments }) => {
  return storageHandler.saveMessage(conversationId, role, content, attachments);
});

ipcMain.handle('storage:update-conversation-title', async (event, { id, title }) => {
  return storageHandler.updateConversationTitle(id, title);
});

ipcMain.handle('storage:delete-conversation', async (event, id) => {
  return storageHandler.deleteConversation(id);
});

ipcMain.handle('storage:search-conversations', async (event, query) => {
  return storageHandler.searchConversations(query);
});

ipcMain.handle('storage:get-last-conversation-id', async () => {
  return storageHandler.getLastConversationId();
});

ipcMain.handle('storage:set-last-conversation-id', async (event, id) => {
  return storageHandler.setLastConversationId(id);
});

// ── FILES ───────────────────────────────────────────────────────────────────

ipcMain.handle('file:select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documentos', extensions: ['txt', 'pdf', 'docx', 'json', 'md'] },
      { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Todos', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { canceled: true, files: [] };
  const files = [];
  for (const filePath of result.filePaths) {
    const info = await fileHandler.readFile(filePath);
    files.push(info);
  }
  return { canceled: false, files };
});

ipcMain.handle('file:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione uma pasta para autorizar acesso',
  });
  if (result.canceled) return { canceled: true };
  const folderPath = result.filePaths[0];
  const listing = await fileHandler.listFolder(folderPath);
  return { canceled: false, folderPath, listing };
});

ipcMain.handle('file:read-folder-file', async (event, filePath) => {
  return await fileHandler.readFile(filePath);
});

// ── MAINTENANCE ─────────────────────────────────────────────────────────────

ipcMain.handle('maintenance:get-app-structure', async () => {
  return maintenanceHandler.getAppStructure();
});

ipcMain.handle('maintenance:create-backup', async () => {
  return maintenanceHandler.createBackup();
});

ipcMain.handle('maintenance:get-logs', async () => {
  return maintenanceHandler.getLogs();
});
