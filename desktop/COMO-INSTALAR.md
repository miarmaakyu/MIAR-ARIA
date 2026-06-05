# MIAR ÁRIA — Como gerar o instalador Windows

## Pré-requisito: ter o projeto no GitHub

1. Crie um repositório no GitHub (github.com → New repository)
2. Clone ou faça push deste projeto para o repositório

## Gerar o instalador automático (GitHub Actions)

Após dar push no repositório, o GitHub Actions roda automaticamente.

### Passo a passo:

1. Acesse seu repositório no GitHub
2. Clique na aba **Actions**
3. Clique no workflow **"Build MIAR ARIA Windows Installer"**
4. Aguarde o build terminar (~5–10 minutos)
5. Clique no build concluído
6. Role até **Artifacts** no final da página
7. Clique em **MIAR-ARIA-Setup-Windows** para baixar o `.zip`
8. Extraia o `.zip` — dentro estará o `MIAR ARIA Setup.exe`

## Instalar no Windows

1. Dê dois cliques no `MIAR ARIA Setup.exe`
2. Se o Windows Defender perguntar: clique em **"Mais informações" → "Executar assim mesmo"**
3. Siga o instalador
4. Abra pelo ícone na área de trabalho ou menu iniciar
5. Clique em ⚙ Configurações e adicione suas chaves de IA
6. Comece a usar

## Chaves necessárias (colocar dentro do app, em ⚙ Configurações)

| Provider | Formato | Onde obter | Ideal |
|----------|---------|------------|-------|
| Groq | `gsk_…` | groq.com | 3 chaves |
| Gemini | `AIza…` | aistudio.google.com | 2 chaves |
| OpenRouter | `sk-or-v1-…` | openrouter.ai | 1–2 chaves |
| Mem0 (opcional) | token | app.mem0.ai | 1 chave |

## Forçar build manualmente

Na aba Actions → workflow → **Run workflow** → Run workflow

## Dados do usuário

Os dados ficam em: `%APPDATA%\miar-aria\`
- `settings.json` — configurações e chaves (acesso restrito ao SO)
- `conversations/` — histórico de conversas
- `smart-memory.json` — memórias inteligentes
- `miar-aria.log` — logs internos
