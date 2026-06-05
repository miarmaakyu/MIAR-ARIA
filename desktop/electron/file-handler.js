const fs = require('fs');
const path = require('path');

// Uso pessoal — sem limite de tamanho, todos os tipos aceitos
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.log', '.xml', '.html', '.htm',
  '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
  '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.ps1',
  '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.r', '.m', '.swift', '.kt', '.dart', '.lua', '.pl', '.vb',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.ico']);
const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

async function readFile(filePath) {
  const name = path.basename(filePath);
  const ext  = path.extname(filePath).toLowerCase();

  let stat;
  try { stat = fs.statSync(filePath); } catch (e) {
    return { name, path: filePath, type: ext, content: null, error: `Arquivo não encontrado: ${e.message}` };
  }

  try {
    // ── Texto puro ──
    if (TEXT_EXTENSIONS.has(ext)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { name, path: filePath, type: ext, content: raw, size: stat.size, isText: true };
    }

    // ── PDF ──
    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data   = await pdfParse(buffer);
        return { name, path: filePath, type: '.pdf', content: data.text, size: stat.size, isText: true, pages: data.numpages };
      } catch (e) {
        return { name, path: filePath, type: '.pdf', content: null, error: `Erro ao ler PDF: ${e.message}` };
      }
    }

    // ── DOCX / DOC ──
    if (ext === '.docx' || ext === '.doc') {
      try {
        const mammoth = require('mammoth');
        const result  = await mammoth.extractRawText({ path: filePath });
        return { name, path: filePath, type: ext, content: result.value, size: stat.size, isText: true };
      } catch (e) {
        return { name, path: filePath, type: ext, content: null, error: `Erro ao ler DOCX: ${e.message}` };
      }
    }

    // ── Imagens ──
    if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const mime   = MIME_MAP[ext] || 'image/png';
      return { name, path: filePath, type: ext, content: `data:${mime};base64,${base64}`, size: stat.size, isImage: true };
    }

    // ── Qualquer outro arquivo — tentar como texto ──
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { name, path: filePath, type: ext, content: raw, size: stat.size, isText: true };
    } catch {
      // binário — enviar como base64
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      return { name, path: filePath, type: ext, content: `[Arquivo binário — ${Math.round(stat.size / 1024)}KB — ${ext}]`, size: stat.size, isBinary: true, base64Snippet: base64.substring(0, 200) };
    }
  } catch (e) {
    return { name, path: filePath, type: ext, content: null, error: `Erro ao ler arquivo: ${e.message}` };
  }
}

function listFolder(folderPath, recursive = false) {
  const files = [];

  function scan(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const ext      = path.extname(entry.name).toLowerCase();
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (entry.isDirectory()) {
        files.push({ name: entry.name, path: fullPath, type: 'directory', isDirectory: true });
        if (recursive && depth < 3) scan(fullPath, depth + 1);
      } else {
        files.push({ name: entry.name, path: fullPath, type: ext, size: stat.size, isDirectory: false });
      }
    }
  }

  try {
    scan(folderPath, 0);
    return { ok: true, files, count: files.length };
  } catch (e) {
    return { ok: false, error: e.message, files: [] };
  }
}

module.exports = { readFile, listFolder };
