// Supabase Edge Function: request-access
// Envia email aos admins pedindo liberacao de acesso para um usuario logado.
//
// Secrets necessarios:
//   supabase secrets set GMAIL_USER=... GMAIL_APP_PASSWORD=...
// Deploy:
//   supabase functions deploy request-access

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
];

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

async function sendEmail(subject: string, content: string) {
  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!gmailUser || !gmailPass) {
    console.warn('GMAIL_USER/GMAIL_APP_PASSWORD nao configurados; pulando envio de email.');
    return;
  }
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  });
  try {
    await client.send({
      from: gmailUser,
      to: ADMIN_RECIPIENTS,
      subject,
      content,
    });
  } finally {
    await client.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: 'nao autenticado' }), { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario');
    const email = String(user.email || body.email || '');
    const requestedRole = body.requestedRole === 'admin' ? 'admin' : 'borrower';
    const requestedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const content =
      `Pedido de liberacao de acesso\n\n` +
      `Nome: ${name}\n` +
      `Email: ${email}\n` +
      `ID do usuario: ${user.id}\n` +
      `Acesso solicitado: ${requestedRole}\n` +
      `Data: ${requestedAt}\n\n` +
      `Para liberar no SQL Editor do Supabase:\n\n` +
      `update public.profiles\n` +
      `set role = '${requestedRole}', full_name = '${escapeSql(name)}'\n` +
      `where id = '${user.id}';`;

    await sendEmail(`Liberar acesso ao Estudio ASSEGO: ${name}`, content);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
