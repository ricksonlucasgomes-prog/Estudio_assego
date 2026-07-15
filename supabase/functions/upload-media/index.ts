// Supabase Edge Function: upload-media
// Recebe a foto do equipamento (autenticada), envia para o Google Drive do Lucas
// (pasta já definida) e dispara um e-mail de aviso com a foto anexada.
//
// NUNCA colocar estes segredos no frontend. Configure com:
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
//     GOOGLE_REFRESH_TOKEN=... DRIVE_FOLDER_ID=18cH79GjFKmY4RcAW8ngFlnd_0EEBxU7U \
//     RESEND_API_KEY=... MAIL_FROM="Estudio ASSEGO <avisos@seu-dominio>" \
//     MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
// Deploy:  supabase functions deploy upload-media
//
// O GOOGLE_REFRESH_TOKEN e gerado uma vez, autorizando a conta Google do Lucas
// no escopo https://www.googleapis.com/auth/drive.file (ver SETUP_BACKEND.md).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'https://controle-estudio-assego-privado.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Escapa valores antes de interpola-los no HTML do e-mail (evita injecao de
// HTML/markup a partir de dados enviados pelo cliente autenticado).
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

async function googleAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
    client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
    refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN') ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) throw new Error('Falha ao renovar token Google: ' + (await res.text()));
  return (await res.json()).access_token as string;
}

async function uploadToDrive(token: string, name: string, bytes: Uint8Array, mime: string) {
  const folderId = Deno.env.get('DRIVE_FOLDER_ID');
  const metadata = { name, parents: folderId ? [folderId] : undefined };
  const boundary = 'assego' + crypto.randomUUID();
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(pre.length + bytes.length + post.length);
  payload.set(pre, 0);
  payload.set(bytes, pre.length);
  payload.set(post, pre.length + bytes.length);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload },
  );
  if (!res.ok) throw new Error('Falha no upload ao Drive: ' + (await res.text()));
  return await res.json() as { id: string; webViewLink: string };
}

async function sendEmail(subject: string, html: string, bytes: Uint8Array, filename: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return;
  const b64 = btoa(String.fromCharCode(...bytes));
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('MAIL_FROM'),
      to: (Deno.env.get('MAIL_TO') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      html,
      attachments: [{ filename, content: b64 }],
    }),
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const origin = req.headers.get('origin') ?? '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'Origem não autorizada.' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  try {
    // Autenticação: exige um usuário Supabase logado.
    const authHeader = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: 'não autenticado' }), { status: 401, headers: cors });

    // A identidade de quem enviou vem SEMPRE do token autenticado, nunca do
    // corpo da requisição (que é falsificável pelo cliente).
    const authUser = userData.user;
    const senderEmail = authUser.email ?? '-';
    const senderName = String(authUser.user_metadata?.full_name ?? '').trim()
      || (authUser.email ? authUser.email.split('@')[0] : 'Usuário');

    const { photo, title, equipmentName } = await req.json();
    if (!photo || typeof photo !== 'string') return new Response(JSON.stringify({ error: 'foto ausente' }), { status: 400, headers: cors });

    const { bytes, mime } = dataUrlToBytes(photo);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeEquipmentName = String(equipmentName ?? 'equipamento').slice(0, 160);
    const filename = `${safeEquipmentName} - ${stamp}.jpg`.replace(/[\\/]/g, '-');

    const token = await googleAccessToken();
    const drive = await uploadToDrive(token, filename, bytes, mime);

    const html = `
      <h2>Nova foto de equipamento</h2>
      <p><b>Equipamento:</b> ${escapeHtml(equipmentName ?? '-')}</p>
      <p><b>Titulo:</b> ${escapeHtml(title ?? '-')}</p>
      <p><b>Enviado por:</b> ${escapeHtml(senderName)} (${escapeHtml(senderEmail)})</p>
      <p><b>No Drive:</b> <a href="${escapeHtml(drive.webViewLink)}">${escapeHtml(drive.webViewLink)}</a></p>`;
    await sendEmail(`Foto de equipamento: ${safeEquipmentName}`, html, bytes, filename);

    return new Response(JSON.stringify({ ok: true, driveFileId: drive.id, webViewLink: drive.webViewLink }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
