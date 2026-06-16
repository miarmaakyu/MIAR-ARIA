/**
 * MIAR ÁRIA — System Handler
 * Executa comandos PowerShell no Windows com spawn correto + timeout + captura de output.
 */

const { spawn } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const CMD_TIMEOUT_MS = 120000; // 2 minutos para comandos longos

/**
 * Executa PowerShell via spawn (correto — sem aspas erradas nos argumentos)
 */
function runPowerShell(command) {
  return new Promise((resolve) => {
    const wrapped = `try { ${command} } catch { Write-Output "ERRO_PS: $_" }`;

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', wrapped,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, stdout: stdout.trim(), stderr: 'Timeout após 30s.', exitCode: -1, command });
    }, CMD_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
        command,
      });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: '', stderr: e.message, exitCode: -1, command });
    });
  });
}

/**
 * Executa CMD clássico via spawn
 */
function runCmd(command) {
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/c', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, stdout: stdout.trim(), stderr: 'Timeout após 30s.', exitCode: -1, command });
    }, CMD_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0, command });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: '', stderr: e.message, exitCode: -1, command });
    });
  });
}

/**
 * Executa comando — PowerShell por padrão
 */
async function runCommand(command) {
  if (!command || !command.trim()) {
    return { ok: false, stdout: '', stderr: 'Comando vazio.', exitCode: -1 };
  }
  const cmd = command.trim();

  // Bloqueios mínimos de segurança
  const BLOCKED = [
    /format\s+[a-z]:\s*$/i,
    /del\s+\/f\s+\/s\s+\/q\s+c:\\\s*$/i,
    /rmdir\s+\/s\s+\/q\s+c:\\\s*$/i,
  ];
  for (const p of BLOCKED) {
    if (p.test(cmd)) return { ok: false, stdout: '', stderr: 'Comando bloqueado por segurança.', exitCode: -1 };
  }

  return runPowerShell(cmd);
}

/**
 * Coleta informações do sistema para o contexto da IA
 */
function getSystemInfo() {
  try {
    const appDir     = path.dirname(path.dirname(__filename));
    const electronDir = path.join(appDir, 'electron');
    const srcDir      = path.join(appDir, 'src');

    return {
      os:         `Windows ${os.release()}`,
      arch:       os.arch(),
      hostname:   os.hostname(),
      username:   os.userInfo().username,
      homeDir:    os.homedir(),
      tempDir:    os.tmpdir(),
      totalMemGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
      freeMemGB:  (os.freemem()  / 1024 / 1024 / 1024).toFixed(1),
      cpus:       os.cpus().length,
      cpuModel:   os.cpus()[0]?.model || 'desconhecido',
      platform:   os.platform(),
      uptime:     Math.round(os.uptime() / 3600) + 'h',
      appDir,
      electronDir,
      srcDir,
      selfFiles: {
        aiHandler:      path.join(electronDir, 'ai-handler.js'),
        mainHandler:    path.join(electronDir, 'main.js'),
        memoryHandler:  path.join(electronDir, 'memory-handler.js'),
        systemHandler:  path.join(electronDir, 'system-handler.js'),
        storageHandler: path.join(electronDir, 'storage-handler.js'),
        fileHandler:    path.join(electronDir, 'file-handler.js'),
        renderer:       path.join(srcDir, 'renderer.js'),
        styles:         path.join(srcDir, 'styles.css'),
        html:           path.join(srcDir, 'index.html'),
      },
    };
  } catch {
    return {};
  }
}

module.exports = { runCommand, runPowerShell, runCmd, getSystemInfo };
