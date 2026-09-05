/**
 * Worker entry point.
 *
 * Deliberately bare: the API routes land here once the service layer exists.
 * What this does establish is the shape everything else plugs into — the D1
 * binding, and the fact that every request arrives having already passed
 * Cloudflare Access, carrying a JWT this Worker must verify (never trusting
 * the Cf-Access-Authenticated-User-Email header on its own).
 */

export interface Env {
  DB: D1Database;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const { results } = await env.DB.prepare(
        "SELECT COUNT(*) AS transactions FROM transactions WHERE deleted_at IS NULL",
      ).all();
      return Response.json({ ok: true, ...results[0] });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
