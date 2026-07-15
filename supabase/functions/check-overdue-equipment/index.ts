// Supabase Edge Function: check-overdue-equipment
// Roda 1x por dia (via pg_cron, ver supabase/cron_overdue_equipment.sql) e
// avisa por e-mail o Lucas + quem retirou o equipamento quando o prazo de
// devolução (7 dias corridos a partir de studio_checkouts.taken_at) vence.
//
// Secrets necessários (já configurados para submit-booking):
//   supabase secrets set GMAIL_USER=... GMAIL_APP_PASSWORD=...
//   supabase secrets set CRON_SECRET=...
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente
// pelo Supabase em toda Edge Function.
//
// Deploy:
//   supabase functions deploy check-overdue-equipment

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

// Função de cron (servidor-para-servidor com x-cron-secret): normalmente não
// recebe Origin de navegador. Mantemos uma allowlist por consistência; quando
// não há Origin correspondente, simplesmente não emitimos Access-Control-Allow-Origin.
const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'https://controle-estudio-assego-privado.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
])

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const LUCAS_EMAIL = 'ricksonlucasgomes@gmail.com'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

async function sendOverdueEmail(to: string[], subject: string, content: string) {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) {
    console.warn('GMAIL_USER/GMAIL_APP_PASSWORD não configurados; pulando envio de e-mail.')
    return
  }
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })
  try {
    await client.send({ from: gmailUser, to, subject, content })
  } finally {
    await client.close()
  }
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const expectedSecret = Deno.env.get('CRON_SECRET') ?? ''
  const providedSecret = req.headers.get('x-cron-secret') ?? ''
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: checkouts, error } = await supabase
      .from('studio_checkouts')
      .select('item_id, user_name, user_id, user_email, qty, taken_at')

    if (error) throw error

    const now = Date.now()
    const overdue = (checkouts ?? []).filter((c) => {
      const takenAt = new Date(c.taken_at).getTime()
      return now - takenAt > SEVEN_DAYS_MS
    })

    let notified = 0
    for (const item of overdue) {
      const takenAt = new Date(item.taken_at)
      const dueDate = new Date(takenAt.getTime() + SEVEN_DAYS_MS)
      const daysLate = Math.floor((now - dueDate.getTime()) / (24 * 60 * 60 * 1000))

      let borrowerEmail = item.user_email as string | null
      if (!borrowerEmail && item.user_id) {
        const { data: userData } = await supabase.auth.admin.getUserById(item.user_id)
        borrowerEmail = userData?.user?.email ?? null
      }

      const recipients = Array.from(new Set([LUCAS_EMAIL, ...(borrowerEmail ? [borrowerEmail] : [])]))

      const content =
        `O equipamento "${item.item_id}" (${item.qty} unidade(s)) retirado por ${item.user_name} ` +
        `venceu o prazo de devolução de 7 dias corridos (retirado em ${takenAt.toLocaleDateString('pt-BR')}, ` +
        `${daysLate} dia(s) de atraso).\n\n` +
        `Por favor, devolva o quanto antes. Caso a devolução não seja feita, o caso poderá ser escalado à ` +
        `Presidência da ASSEGO.\n\n` +
        `Acesse o app: https://assegostudio.vercel.app`

      await sendOverdueEmail(recipients, `Equipamento atrasado: ${item.item_id}`, content)
      notified += 1
    }

    return new Response(JSON.stringify({ ok: true, overdue: overdue.length, notified }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
