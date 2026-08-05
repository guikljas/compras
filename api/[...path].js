const crypto = require('node:crypto');

const roles = { Administrador: 3, Comprador: 2, Consulta: 1 };
const entities = new Set([
  'suppliers', 'products', 'invoices', 'users',
  'plans', 'companies', 'categories'
]);

const clean = value => String(value ?? '').trim();

const env = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
};

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

const send = (res, status, payload, extra = {}) => {
  const responseHeaders = {
    ...headers,
    'Cache-Control': 'no-store',
    ...extra
  };

  res.statusCode = status;

  for (const [key, value] of Object.entries(responseHeaders)) {
    res.setHeader(key, value);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const parseBody = req => {
  if (typeof req.body === 'object' && req.body !== null) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
};

const cookie = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, saved) => {
  const [salt, hash] = String(saved).split(':');
  if (!salt || !hash) return false;

  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'))
  );
};

async function db(table, { method = 'GET', query = {}, body, prefer } = {}) {
  const url = new URL(`/rest/v1/${table}`, env('SUPABASE_URL'));

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }

  const key = env('SUPABASE_SECRET_KEY');

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let result;

  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof result === 'object'
        ? (result.message || result.hint || 'Erro no banco de dados.')
        : 'Erro no banco de dados.'
    );
  }

  return { data: result, headers: response.headers };
}

async function one(table, query) {
  const { data } = await db(table, { query: { ...query, limit: 1 } });
  return data?.[0] || null;
}

async function ensureAdmin() {
  const email = clean(process.env.ADMIN_EMAIL || 'compras01@erimax.com.br').toLowerCase();

  if (await one('users', { email: `eq.${email}` })) return;

  const password = String(process.env.ADMIN_PASSWORD || '');

  if (password.length < 12) {
    throw new Error('Defina ADMIN_PASSWORD com ao menos 12 caracteres na Vercel.');
  }

  await db('users', {
    method: 'POST',
    body: {
      name: 'Administrador',
      email,
      password_hash: hashPassword(password),
      role: 'Administrador'
    },
    prefer: 'return=minimal'
  });
}

async function currentUser(req) {
  const token = cookie(req, 'cc_session');
  if (!token) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const session = await one('sessions', {
    token_hash: `eq.${tokenHash}`,
    expires_at: `gt.${Date.now()}`
  });

  if (!session) return null;

  return one('users', {
    id: `eq.${session.user_id}`,
    active: 'eq.true'
  });
}

const requireUser = async (req, res, minimumRole = 1) => {
  const user = await currentUser(req);

  if (!user) {
    send(res, 401, { error: 'Sessão inválida ou expirada.' });
    return null;
  }

  if (roles[user.role] < minimumRole) {
    send(res, 403, { error: 'Você não tem permissão para esta ação.' });
    return null;
  }

  return user;
};

const fields = {
  suppliers: ['name', 'cnpj', 'contact', 'phone', 'email'],
  products: ['name', 'code', 'category', 'unit'],
  plans: ['code', 'name'],
  companies: ['code', 'name', 'cnpj'],
  categories: ['name', 'description'],
  invoices: [
    'number', 'date', 'supplier', 'sector', 'plan_code', 'total',
    'purchase_location', 'company', 'expense_type',
    'product_name', 'quantity'
  ]
};

const loginAttempts = new Map();

function allowed(req) {
  const ip = (
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();

  const now = Date.now();
  const previous = loginAttempts.get(ip);

  if (!previous || now - previous.time > 900000) {
    loginAttempts.set(ip, { time: now, count: 1 });
    return true;
  }

  if (previous.count >= 10) return false;

  previous.count++;
  return true;
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && ';|,'.includes(char)) {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;

      row.push(value.trim());

      if (row.some(Boolean)) rows.push(row);

      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);

  return rows;
}

const norm = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

async function importCsv(text) {
  if (typeof text !== 'string' || text.length > 3_000_000) {
    throw new Error('Envie um CSV de até 3 MB.');
  }

  const rows = csvRows(text.replace(/^\uFEFF/, ''));

  if (rows.length < 2) {
    throw new Error('O CSV precisa ter cabeçalho e ao menos uma linha.');
  }

  const header = rows.shift().map(norm);
  const index = (...names) => header.findIndex(item => names.includes(item));

  const columns = {
    date: index('data', 'datacompra'),
    location: index('localdecompra', 'local'),
    company: index('qualempresa', 'empresa'),
    sector: index('setor'),
    expense: index('tipodedespesa', 'despesa'),
    product: index('produto'),
    quantity: index('quantidade', 'qtd'),
    total: index('valortotal', 'valor')
  };

  if (Object.values(columns).some(value => value < 0)) {
    throw new Error('Use o modelo de colunas disponibilizado.');
  }

  const entries = rows.map((row, rowIndex) => {
    const get = key => clean(row[columns[key]]);
    const rawDate = get('date');

    const date = /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)
      ? `${rawDate.slice(6)}-${rawDate.slice(3, 5)}-${rawDate.slice(0, 2)}`
      : rawDate;

    const total = Number(get('total').replace(/\./g, '').replace(',', '.'));
    const quantity = Number(get('quantity').replace(',', '.'));

    if (
      !date ||
      !get('location') ||
      !get('company') ||
      !get('sector') ||
      !get('expense') ||
      !get('product') ||
      !Number.isFinite(total) ||
      !Number.isFinite(quantity)
    ) {
      throw new Error(`Linha ${rowIndex + 2}: confira os campos.`);
    }

    return {
      date,
      location: get('location'),
      company: get('company').toUpperCase(),
      sector: get('sector'),
      expense: get('expense'),
      product: get('product'),
      total,
      quantity
    };
  });

  for (const entry of entries) {
    const upsert = async (table, match, body) => {
      if (!await one(table, match)) {
        await db(table, {
          method: 'POST',
          body,
          prefer: 'return=minimal'
        });
      }
    };

    await upsert(
      'companies',
      { code: `eq.${entry.company}` },
      { code: entry.company, name: entry.company }
    );

    await upsert(
      'categories',
      { name: `eq.${entry.expense}` },
      { name: entry.expense }
    );

    await upsert(
      'suppliers',
      { name: `eq.${entry.location}` },
      { name: entry.location }
    );

    await upsert(
      'products',
      { name: `eq.${entry.product}` },
      { name: entry.product, category: entry.expense, unit: 'UN' }
    );

    let plan = await one('plans', {
      or: `(code.eq.${entry.sector.toUpperCase()},name.eq.${entry.sector})`
    });

    if (!plan) {
      const code = entry.sector
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 20) || 'SETOR';

      plan = await one('plans', { code: `eq.${code}` });

      if (!plan) {
        await db('plans', {
          method: 'POST',
          body: { code, name: entry.sector },
          prefer: 'return=representation'
        });

        plan = await one('plans', { code: `eq.${code}` });
      }
    }

    await db('invoices', {
      method: 'POST',
      body: {
        number: `CSV-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        date: entry.date,
        supplier: entry.location,
        sector: plan.code,
        plan_code: plan.code,
        total: entry.total,
        purchase_location: entry.location,
        company: entry.company,
        expense_type: entry.expense,
        product_name: entry.product,
        quantity: entry.quantity
      },
      prefer: 'return=minimal'
    });
  }

  return entries.length;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://local');

  const path = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);

  // Health check
  if (path[0] === 'health') {
    return send(res, 200, { ok: true });
  }

  // Inicializa o banco apenas para as outras rotas
  await ensureAdmin();

  const [entity, id] = path;
  const method = req.method;

};

      const { email, password } = parseBody(req);

      const user = await one('users', {
        email: `eq.${clean(email).toLowerCase()}`,
        active: 'eq.true'
      });

      if (!user || !verifyPassword(password || '', user.password_hash)) {
        return send(res, 401, {
          error: 'E-mail ou senha incorretos.'
        });
      }

      const token = crypto.randomBytes(32).toString('base64url');

      await db('sessions', {
        method: 'POST',
        body: {
          token_hash: crypto.createHash('sha256').update(token).digest('hex'),
          user_id: user.id,
          expires_at: Date.now() + 8 * 3600 * 1000
        },
        prefer: 'return=minimal'
      });

      return send(
        res,
        200,
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        },
        {
          'Set-Cookie': `cc_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
        }
      );
    }

    if (entity === 'auth' && id === 'logout' && method === 'POST') {
      const token = cookie(req, 'cc_session');

      if (token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        await db('sessions', {
          method: 'DELETE',
          query: { token_hash: `eq.${tokenHash}` }
        });
      }

      return send(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': 'cc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
        }
      );
    }

    if (entity === 'auth' && id === 'me' && method === 'GET') {
      const user = await requireUser(req, res);

      if (user) send(res, 200, { user });

      return;
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (entity === 'invoices' && id === 'import-csv' && method === 'POST') {
      if (roles[user.role] < 2) {
        return send(res, 403, { error: 'Sem permissão.' });
      }

      return send(res, 201, {
        imported: await importCsv(parseBody(req).csv)
      });
    }

    if (!entities.has(entity)) {
      return send(res, 404, { error: 'Recurso não encontrado.' });
    }

    if (method === 'GET') {
      if (entity === 'users' && roles[user.role] < 3) {
        return send(res, 403, {
          error: 'Apenas administradores podem consultar usuários.'
        });
      }

      if (entity === 'products') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const limit = Math.min(
          100,
          Math.max(10, Number(url.searchParams.get('limit')) || 50)
        );

        const search = clean(url.searchParams.get('q'))
          .replace(/[(),%*]/g, '');

        const query = {
          select: '*',
          order: 'name.asc,id.asc',
          limit,
          offset: (page - 1) * limit
        };

        if (search) {
          query.or = `(name.ilike.*${search}*,code.ilike.*${search}*,category.ilike.*${search}*)`;
        }

        const result = await db('products', {
          query,
          prefer: 'count=exact'
        });

        const total = Number(
          (result.headers.get('content-range') || '*/0').split('/')[1]
        );

        return send(res, 200, {
          items: result.data || [],
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit))
        });
      }

      const query = {
        select: entity === 'users'
          ? 'id,name,email,role,active,created_at'
          : '*',
        order: entity === 'plans' ? 'code.asc' : 'id.desc'
      };

      if (entity === 'plans') query.active = 'eq.true';

      const result = await db(entity, { query });

      return send(res, 200, { items: result.data || [] });
    }

    if (method === 'POST') {
      const minimumRole = entity === 'users' ? 3 : 2;

      if (roles[user.role] < minimumRole) {
        return send(res, 403, {
          error: 'Você não tem permissão para este cadastro.'
        });
      }

      const value = parseBody(req);

      if (entity === 'users') {
        const email = clean(value.email).toLowerCase();
        const password = String(value.password || '');

        if (
          !clean(value.name) ||
          !/^\S+@\S+\.\S+$/.test(email) ||
          !roles[value.role] ||
          password.length < 8
        ) {
          return send(res, 400, {
            error: 'Informe os dados obrigatórios.'
          });
        }

        const result = await db('users', {
          method: 'POST',
          body: {
            name: clean(value.name),
            email,
            password_hash: hashPassword(password),
            role: value.role
          },
          prefer: 'return=representation'
        });

        return send(res, 201, { id: result.data[0].id });
      }

      if (entity === 'invoices') {
        const planCode = clean(value.planCode);
        const total = Number(value.total);
        const quantity = Number(value.quantity);

        if (
          !clean(value.number) ||
          !clean(value.date) ||
          !clean(value.supplier) ||
          !planCode ||
          !Number.isFinite(total) ||
          total < 0
        ) {
          return send(res, 400, {
            error: 'Preencha os dados obrigatórios da compra.'
          });
        }

        const result = await db('invoices', {
          method: 'POST',
          body: {
            number: clean(value.number),
            date: clean(value.date),
            supplier: clean(value.supplier),
            sector: planCode,
            plan_code: planCode,
            total,
            purchase_location: clean(value.supplier),
            company: clean(value.company).toUpperCase(),
            expense_type: clean(value.expenseType),
            product_name: clean(value.productName),
            quantity: Number.isFinite(quantity) ? quantity : 0
          },
          prefer: 'return=representation'
        });

        return send(res, 201, { id: result.data[0].id });
      }

      const input = {};

      for (const key of fields[entity] || []) {
        input[key] = clean(value[key]);
      }

      if (!input.name) {
        return send(res, 400, { error: 'O nome é obrigatório.' });
      }

      if (entity === 'companies') {
        input.code = input.code.toUpperCase();
      }

      const result = await db(entity, {
        method: 'POST',
        body: input,
        prefer: 'return=representation'
      });

      return send(res, 201, { id: result.data[0].id });
    }

    if (method === 'PATCH' && id) {
      if (roles[user.role] < 2) {
        return send(res, 403, {
          error: 'Você não tem permissão para editar este cadastro.'
        });
      }

      if (!fields[entity]) {
        return send(res, 405, {
          error: 'Este registro não pode ser editado.'
        });
      }

      const value = parseBody(req);
      const input = {};

      for (const key of fields[entity]) {
        input[key] = key === 'total' || key === 'quantity'
          ? Number(value[key] || 0)
          : clean(value[key]);
      }

      if (entity === 'invoices') {
        const planCode = clean(value.planCode || value.plan_code);

        input.sector = planCode;
        input.plan_code = planCode;
        input.purchase_location = input.supplier;
      }

      if (entity === 'plans' || entity === 'companies') {
        input.code = input.code.toUpperCase();
      }

      await db(entity, {
        method: 'PATCH',
        query: { id: `eq.${id}` },
        body: input,
        prefer: 'return=minimal'
      });

      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    console.error(error);
    return send(res, 500, {
      error: error.message || 'Erro interno.'
    });
  }
};