import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'https://controle-estudio-assego-privado.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
])

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
]

type JsonRecord = Record<string, unknown>

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function safeHeader(value: unknown): string {
  return text(value, 160).replace(/[\r\n]+/g, ' ')
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(req: Request, body: JsonRecord, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

async function resolveAdminRecipients(admin: SupabaseClient): Promise<string[]> {
  const recipients = new Set(ADMIN_RECIPIENTS.map((email) => email.toLowerCase()))
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'developer'])
  if (error) throw error

  const users = await Promise.all((profiles ?? []).map(({ id }) => admin.auth.admin.getUserById(id)))
  users.forEach(({ data, error: userError }) => {
    if (userError) throw userError
    const email = data.user?.email?.trim().toLowerCase()
    if (email) recipients.add(email)
  })
  return [...recipients]
}

async function sendRequestEmail(payload: JsonRecord, recipients: string[]): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) throw new Error('SMTP_NOT_CONFIGURED')

  const requesterName = text(payload.requester_name, 160)
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })

  try {
    await client.send({
      from: gmailUser,
      to: recipients,
      subject: `Pedido de equipamento - ${safeHeader(requesterName)}`,
      content:
        `${requesterName || 'Usuario'} (${text(payload.requester_email, 254) || 'email nao informado'}) ` +
        `pediu acesso ao equipamento "${text(payload.equipment_name, 160)}".\n\n` +
        `Justificativa:\n${text(payload.justification, 1000)}\n\n` +
        'Aprove ou rejeite pelo aplicativo: https://assegostudio.vercel.app',
    })
  } finally {
    await client.close()
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(req, { error: 'Origem nao autorizada.' }, 403)
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Metodo nao permitido.' }, 405)

  const requestId = crypto.randomUUID()
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).length > 8192) {
      return jsonResponse(req, { error: 'Solicitacao muito grande.' }, 413)
    }

    let body: JsonRecord
    try {
      const parsed = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON')
      body = parsed as JsonRecord
    } catch {
      return jsonResponse(req, { error: 'JSON invalido.' }, 400)
    }

    const idempotencyKey = text(body.idempotencyKey ?? req.headers.get('Idempotency-Key'), 64)
    const equipmentId = text(body.equipmentId, 100)
    const equipmentName = text(body.equipmentName, 160) || equipmentId
    const justification = text(body.justification, 1000)
    const requesterName = text(body.requesterName, 160)
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)
      || !equipmentId
      || requesterName.length < 3
      || justification.length < 10) {
      return jsonResponse(req, { error: 'Dados do pedido invalidos ou incompletos.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('BACKEND_NOT_CONFIGURED')

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user?.email) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: allowed, error: rateError } = await admin.rpc('consume_rate_limit_v1', {
      p_actor_id: user.id,
      p_action: 'request_equipment',
      p_limit: 5,
      p_window_seconds: 3600,
    })
    if (rateError) throw rateError
    if (!allowed) return jsonResponse(req, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, 429)

    const { data: result, error: rpcError } = await admin.rpc('create_equipment_request_v1', {
      p_user_id: user.id,
      p_auth_email: user.email,
      p_idempotency_key: idempotencyKey,
      p_request: {
        requesterName,
        equipmentId,
        equipmentName,
        justification,
      },
    })
    if (rpcError) throw rpcError

    const equipmentRequestId = text(result?.request_id, 64)
    const outboxId = text(result?.outbox_id, 64)
    if (!equipmentRequestId) throw new Error('RPC_RESULT_INVALID')
    if (!outboxId) {
      return jsonResponse(req, {
        success: true,
        id: equipmentRequestId,
        notification_status: 'already_processed',
      }, 200)
    }

    const { data: outbox, error: outboxError } = await admin
      .from('notification_outbox')
      .select('id, payload, status, attempts')
      .eq('id', outboxId)
      .single()
    if (outboxError || !outbox) throw outboxError ?? new Error('OUTBOX_NOT_FOUND')
    if (outbox.status === 'sent') {
      return jsonResponse(req, {
        success: true,
        id: equipmentRequestId,
        notification_status: 'already_sent',
      }, 200)
    }

    const { data: claimed, error: claimError } = await admin
      .from('notification_outbox')
      .update({ status: 'sending', attempts: Number(outbox.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', outboxId)
      .in('status', ['pending', 'failed'])
      .select('id')
    if (claimError) throw claimError
    if (!claimed?.length) {
      return jsonResponse(req, {
        success: true,
        id: equipmentRequestId,
        notification_status: 'processing',
      }, 202)
    }

    try {
      const recipients = await resolveAdminRecipients(admin)
      await sendRequestEmail(outbox.payload as JsonRecord, recipients)
      await admin.from('notification_outbox').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', outboxId)

      return jsonResponse(req, {
        success: true,
        id: equipmentRequestId,
        notification_status: 'sent',
      }, 200)
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : 'EMAIL_ERROR'
      await admin.from('notification_outbox').update({
        status: 'failed',
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', outboxId)
      console.error(`[${requestId}] Falha no email de equipamento`, message)
      return jsonResponse(req, {
        success: true,
        id: equipmentRequestId,
        notification_status: 'pending_retry',
        warning: 'Pedido registrado. O email aguarda nova tentativa.',
      }, 202)
    }
  } catch (error) {
    console.error(`[${requestId}] Falha no request-equipment`, error)
    return jsonResponse(req, { error: 'Nao foi possivel enviar o pedido.', request_id: requestId }, 500)
  }
})
