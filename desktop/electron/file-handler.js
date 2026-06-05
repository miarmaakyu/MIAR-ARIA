const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.log', '.xml', '.html', '.css', '.js', '.ts', '.py'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const MAX_TEXT_SIZE = 500 * 1024;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function readFile(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);

  if (stat.size > MAX_FILE_SIZE) {
    return { name, path: filePath, type: ext, content: null, error: `Arquivo muito grande (${Math.round(stat.size / 1024)}KB). Limite: 10MB.` };
  }

  try {
    if (TEXT_EXTENSIONS.includes(ext)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { name, path: filePath, type: ext, content: raw.substring(0, MAX_TEXT_SIZE), size: stat.size, isText: true };
    }

    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        return { name, path: filePath, type: '.pdf', content: data.text.substring(0, MAX_TEXT_SIZE), size: stat.size, isText: true, pages: data.numpages };
      } catch (e) {
        return { name, path: filePath, type: '.pdf', content: null, error: `Erro ao ler PDF: ${e.message}` };
      }
    }

    if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return { name, path: filePath, type: '.docx', content: result.value.substring(0, MAX_TEXT_SIZE), size: stat.size, isText: true };
      } catch (e) {
        return { name, path: filePath, type: '.docx', content: null, error: `Erro ao ler DOCX: ${e.message}` };
      }
    }

    if (IMAGE_EXTENSIONS.includes(ext)) {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
      return { name, path: filePath, type: ext, content: `data:${mimeMap[ext] || 'image/png'};base64,${base64}`, size: stat.size, isImage: true };
    }

    return { name, path: filePath, type: ext, content: null, error: `Tipo não suportado para extração de texto: ${ext}` };
  } catch (e) {
    return { name, path: filePath, type: ext, content: null, error: `Erro ao ler arquivo: ${e.message}` };
  }
}

function listFolder(folderPath) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        files.push({ name: entry.name, path: fullPath, type: 'directory', isDirectory: true });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const stat = fs.statSync(fullPath);
        files.push({ name: entry.name, path: fullPath, type: ext, size: stat.size, isDirectory: false });
      }
    }
    return { ok: true, files, count: files.length };
  } catch (e) {
    return { ok: false, error: e.message, files: [] };
  }
}

module.exports = { readFile, listFolder };
