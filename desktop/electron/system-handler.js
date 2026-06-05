/**
 * MIAR ÁRIA — System Handler
 * Executa comandos PowerShell e CMD no Windows com timeout e captura de output.
 * Uso pessoal — acesso total ao sistema do usuário.
 */

const { exec, execSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const CMD_TIMEOUT_MS = 30000; // 30s por comando

/**
 * Executa um comando PowerShell e retorna { ok, stdout, stderr, exitCode }
 */
function runPowerShell(command) {
  return new Promise((resolve) => {
    // Encapsula em try/catch PowerShell para capturar erros do próprio script
    const wrapped = `try { ${command} } catch { Write-Output "ERRO_PS: $_" }`;
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', wrapped,
    ];
    const child = exec(
      `powershell.exe ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`,
      { timeout: CMD_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          ok: !err || err.code === 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode: err?.code ?? 0,
          command,
        });
      }
    );
    child.on('error', (e) => resolve({ ok: false, stdout: '', stderr: e.message, exitCode: -1, command }));
  });
}

/**
 * Executa CMD clássico
 */
function runCmd(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: CMD_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024, windowsHide: true, shell: 'cmd.exe' },
      (err, stdout, stderr) => {
        resolve({
          ok: !err || err.code === 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode: err?.code ?? 0,
          command,
        });
      }
    );
  });
}

/**
 * Coleta informações do sistema para contexto da IA
 */
function getSystemInfo() {
  try {
    const info = {
      os: `Windows ${os.release()}`,
      arch: os.arch(),
      hostname: os.hostname(),
      username: os.userInfo().username,
      homeDir: os.homedir(),
      tempDir: os.tmpdir(),
      totalMemGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
      freeMemGB:  (os.freemem()  / 1024 / 1024 / 1024).toFixed(1),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'desconhecido',
      platform: os.platform(),
      uptime: Math.round(os.uptime() / 3600) + 'h',
    };
    return info;
  } catch {
    return {};
  }
}

/**
 * Executa comando genérico (detecta tipo automaticamente)
 */
async function runCommand(command) {
  if (!command || !command.trim()) return { ok: false, stdout: '', stderr: 'Comando vazio.', exitCode: -1 };
  const cmd = command.trim();

  // Comandos perigosos bloqueados para segurança mínima
  const BLOCKED = [/format\s+[a-z]:/i, /rm\s+-rf\s+\//i, /del\s+\/f\s+\/s\s+\/q\s+c:\\/i];
  for (const pattern of BLOCKED) {
    if (pattern.test(cmd)) return { ok: false, stdout: '', stderr: 'Comando bloqueado por segurança.', exitCode: -1 };
  }

  // Usa PowerShell por padrão (mais poderoso no Windows 11)
  return runPowerShell(cmd);
}

module.exports = { runCommand, runPowerShell, runCmd, getSystemInfo };
