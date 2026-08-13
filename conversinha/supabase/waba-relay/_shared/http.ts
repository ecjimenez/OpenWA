export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init.headers,
    },
  });
}

export function forbidden() {
  return new Response('forbidden', {
    status: 403,
    headers: corsHeaders,
  });
}

export function preflight(req: Request) {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Erros do supabase-js (Postgrest) são objetos com .message, não instâncias
// de Error — "err instanceof Error" mascararia a mensagem real nesse caso.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as Record<string, unknown>).message);
  return 'erro desconhecido';
}
