# CompraControl — Erimax

## Executar localmente

1. Abra um terminal na pasta do projeto.
2. Revise o arquivo `.env` e defina uma senha forte para `ADMIN_PASSWORD`.
3. Execute `npm start`.
4. Acesse `http://localhost:3000/login`.

Não use Live Server: a aplicação possui uma API local e banco de dados.

## Publicação / hospedagem

O projeto é um servidor Node.js único, com o front-end e a API na mesma origem. No provedor, configure o comando de inicialização como `npm start` e informe as variáveis do `.env` no painel do provedor.

### Vercel + Supabase

Na Vercel, os arquivos do front-end ficam em `public/` e são publicados como conteúdo estático; somente `api/[...path].js` é executado como função serverless. Para que os cadastros persistam entre deploys, use o Supabase (SQLite local não é persistente em funções serverless).

1. No Supabase, execute uma vez o arquivo `supabase-schema.sql` no SQL Editor.
2. Copie `.env.example` para `.env` apenas para documentar os valores locais; não inclua senhas nem chaves no Git.
3. Em **Vercel > Settings > Environment Variables**, crie `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` para Production, Preview e Development.
4. Use a **Secret Key** do Supabase somente na Vercel. Ela não pode ser exposta no navegador.

O arquivo `vercel.json` entrega o painel em `/`, o login em `/login` e a verificação de saúde em `/health`.

- Use Node.js 22.5 ou superior.
- Defina uma senha longa e exclusiva em `ADMIN_PASSWORD` antes do primeiro deploy.
- Deixe `RESET_ADMIN_PASSWORD=true` somente no primeiro início para substituir a senha inicial; depois altere para `false` e faça novo deploy.
- Use `COOKIE_SECURE=auto` para ativar cookies seguros em HTTPS e manter o acesso local em `http://localhost`. Se preferir, aceite apenas HTTPS usando `true`.
- O SQLite precisa ficar em armazenamento persistente. Monte um volume no caminho do `DB_FILE`; em ambientes efêmeros, o banco é perdido a cada novo deploy.
- Use `GET /health` como verificação de saúde no provedor.

## Banco de dados e segurança

Os dados são persistidos em `compras-control.db` (SQLite). A API usa senha com hash scrypt, cookies de sessão HttpOnly/Secure, expiração de sessão, limitação de tentativas de login, limites de requisição e perfis Administrador, Comprador e Consulta.

## Importação de NF-e

Na página **Compras**, use **Importar XML** e selecione o XML padrão de uma NF-e. O sistema extrai número, data de emissão, emitente e valor total, cadastra o fornecedor caso ainda não exista e registra a nota. O arquivo XML é processado somente para importação e não é armazenado.

## Setores

Em **Gestão > Setores**, o responsável pelo sistema pode criar os próprios setores e seus códigos. Nenhum setor vem cadastrado por padrão. Cada nota fiscal manual é vinculada a um setor, e o comparativo de gastos passa a ser agrupado por setor.

## Importação de compras por CSV

Em **Compras**, use **Importar planilha** e selecione um arquivo CSV. Baixe o modelo pela própria tela ou use `modelo-importacao-compras.csv`. O arquivo deve ter, nesta ordem ou com estes cabeçalhos: `DATA`, `LOCAL DE COMPRA`, `QUAL EMPRESA`, `SETOR`, `TIPO DE DESPESA`, `PRODUTO`, `QUANTIDADE` e `VALOR TOTAL`.

Cada linha cria a compra e cadastra automaticamente empresa, fornecedor, setor, tipo de despesa e produto quando ainda não existirem. As empresas iniciais são `ERIMAR`, `LEITE`, `BLOCOS`, `RANCHO` e `MARK`; novos códigos também podem ser cadastrados em **Empresas**.

## Cadastros

O menu de gestão inclui cadastros de **Empresas**, **Fornecedores**, **Produtos**, **Tipos de despesa** e **Setores**. Esses registros podem ser feitos antes da importação ou criados automaticamente ao importar uma planilha.
