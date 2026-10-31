import http from "node:http";
import { stat } from "node:fs/promises";

// QA only: fixture data is isolated in this local helper, never in the Worker.
// No external requests, production credentials, database or router connections.
const port = Number(process.env.PREVIEW_PORT || 4173);
const workerUrl = new URL("../src/index.js", import.meta.url);
const validScenarios = new Set(["filled", "empty", "error", "slow"]);
const validRoles = new Set(["admin", "operator", "viewer"]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
globalThis.fetch = () => { throw new Error("Preview prohibits external network calls"); };

function fixtures(scenario, role) {
  const now = Date.now(), empty = scenario === "empty", count = value => empty ? 0 : value;
  const site = { id: "qa-local", name: "Estabelecimento de teste", mode: "standard", sales_enabled: 1,
    portal_title: "Wi-Fi de teste", portal_subtitle: "Prévia local sem cobrança ou liberação real.", background_mode: "gradient",
    router_host_count: count(7), router_last_seen_at: empty ? null : now - 15000, about_title: "Ambiente de testes", about_text: "Dados locais para revisão da interface.",
    privacy_title: "Privacidade", privacy_text: "Este ambiente não coleta dados reais.", emergency_message: "Vendas de teste pausadas.", created_at: now - 86400000, updated_at: now };
  const routerRows = empty ? [] : [
    { id: "qa-fresh", name: "MikroTik de teste principal", enabled: 1, online: true, last_seen_at: now - 15000, ageMs: 15000, identity: "QA-ROUTER", board: "hEX", version: "7.16.1", install_mode: "agent", install_status: "installed", install_step: "complete", install_message: "Instalação de teste concluída", lanPorts: [], last_public_ip: "192.0.2.10" },
    { id: "qa-stale", name: "MikroTik de teste sem contato", enabled: 1, online: false, last_seen_at: now - 300000, ageMs: 300000, identity: "QA-STALE", board: "hAP", version: "7.16.1", install_mode: "agent", install_status: "error", install_step: "config", install_message: "Falha de teste no provisionamento", lanPorts: [] },
    { id: "qa-disabled", name: "MikroTik de teste desativada", enabled: 0, online: false, last_seen_at: now - 5000, ageMs: 5000, identity: "QA-DISABLED", board: "hEX", version: "7.16.1", install_mode: "agent", install_status: "installed", install_step: "complete", lanPorts: [] },
  ];
  const siteCard = { id: site.id, name: site.name, mode: site.mode, salesEnabled: true, routerTotal: count(3), routerOnline: count(1), routerOffline: count(1), routerDisabled: count(1), routerLegacy: false,
    routerHostCount: count(7), lastSeenAt: site.router_last_seen_at, visitorsToday: count(20), paidToday: count(4), revenueTodayCents: count(2000), feesTodayCents: count(40), netTodayCents: count(1960), activeGrants: count(3), pendingPayments: count(2), updatedAt: now };
  const summary = { sites: 1, routers: count(3), routersOnline: count(1), routersOffline: count(1), routersDisabled: count(1), clients: count(7), visitors: count(20), sales: count(4), grossCents: count(2000), netCents: count(1960), activeGrants: count(3), pendingPayments: count(2) };
  const metrics = { routerOnline: !empty, routerHostCount: count(7), visitorsToday: count(20), paidToday: count(4), revenueTodayCents: count(2000), feesTodayCents: count(40), netTodayCents: count(1960), activeGrants: count(3), pendingPayments: count(2), activeAttempts: count(1), paymentStartsToday: count(6), failedPaymentsToday: 0, conversionPct: count(20), approvalPct: count(66.7), averageTicketCents: count(500), netMarginPct: count(98), salesTrendPct: null, revenueTrendPct: null };
  const hourly = empty ? [] : [{ hour: "10:00", sales: 1, revenueCents: 500 }, { hour: "11:00", sales: 3, revenueCents: 1500 }];
  const plans = empty ? [] : [{ id: "qa-plan", name: "Plano de teste", slug: "plano-teste", mode: "standard", price_cents: 500, duration_seconds: 3600, max_devices: 1, sort_order: 0, enabled: 1, rate_limit_down_kbps: 10000, rate_limit_up_kbps: 5000 }];
  const recentPayments = empty ? [] : ["approved", "pending", "expired"].map((status, i) => ({ id: `qa-payment-${i}`, status, plan_name: "Plano de teste", amount_cents: 500, payer_email: `teste${i}@example.invalid`, phone_e164: "", created_at: now - i * 60000 }));
  return {
    me: { ok: true, user: { username: "qa-local", displayName: "Teste local", role, source: "preview" } },
    platform: { ok: true, currentSiteId: site.id, scope: { mode: "single-site", siteId: site.id, canSwitchSite: false }, offlineAfterMs: 90000, summary, sites: [siteCard], services: { worker: true, d1: true, r2: true, mercadoPago: true, webhook: true }, generatedAt: now },
    dashboard: { ok: true, site, event: null, metrics, hourly, groups: [], recentPayments },
    routers: { ok: true, routers: routerRows, pendingEnrollments: [], generatedAt: now, offlineAfterMs: 90000 },
    plans: { ok: true, plans }, users: { ok: true, users: empty ? [] : [{ id: "qa-user'\"><img data-qa-injection src=x>", hostname: "Dispositivo de teste <QA>", macs: ["02:00:00:00:00:01"], last_seen_at: now, active_until: now + 3600000, payer_email: "qa@example.invalid" }] }, codes: { ok: true, codes: [] }, groups: { ok: true, groups: [] }, events: { ok: true, events: [] }, audit: { ok: true, audit: [] }, accounts: { ok: true, accounts: [] },
    report: { ok: true, summary: { sales: count(4), buyers: count(4), visitors: count(20), conversionPct: count(20), grossCents: count(2000), feesCents: count(40), netCents: count(1960), groupOccupancyPct: 0 }, hourly, plans: empty ? [] : [{ name: "Plano de teste", sales: 4, revenue_cents: 2000 }] },
    diagnostics: { ok: true, router: { ok: !empty, identity: "QA-ROUTER", hosts: count(7), lastSeenAt: site.router_last_seen_at }, d1: { ok: true, latencyMs: 1 }, mercadoPago: { ok: true, latencyMs: 1 }, webhook: { configured: true, lastSeenAt: null }, media: { ok: true }, latestPayment: null, pendingPayments: count(2), lastReconcileAt: null },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/__qa/recover") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "qa_scenario=filled; Path=/; SameSite=Strict" });
      res.end('{"ok":true}');
      return;
    }
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim().split("=")));
    const rawScenario = url.searchParams.get("scenario") || cookies.qa_scenario || "filled";
    const rawRole = url.searchParams.get("role") || cookies.qa_role || "admin";
    const scenario = validScenarios.has(rawScenario) ? rawScenario : "filled";
    const role = validRoles.has(rawRole) ? rawRole : "admin";
    const data = fixtures(scenario, role);
    let response;
    if (url.pathname.startsWith("/api/admin/")) {
      const name = url.pathname.slice("/api/admin/".length);
      if (scenario === "slow" && name !== "me") await new Promise(resolve => setTimeout(resolve, 1600));
      if (scenario === "error" && ["platform", "routers"].includes(name)) response = json({ ok: false, error: "preview_simulated_unavailable" }, 503);
      else if (req.method !== "GET") response = json({ ok: false, error: "preview_read_only_no_changes_saved" }, 409);
      else response = json(data[name] || { ok: false, error: "preview_endpoint_not_configured" }, data[name] ? 200 : 404);
    } else {
      const sourceStat = await stat(workerUrl);
      const { default: worker } = await import(`${workerUrl.href}?preview=${sourceStat.mtimeMs}`);
      const path = url.pathname.startsWith("/assets/") ? "/assets/logo.svg" : url.pathname === "/" ? "/admin" : url.pathname;
      response = await worker.fetch(new Request(`http://127.0.0.1:${port}${path}`), {}, {});
      if (response.headers.get("content-type")?.includes("text/html")) {
        const banner = `<aside style="position:fixed;bottom:82px;right:10px;z-index:99999;max-width:calc(100vw - 20px);background:#172536;color:#fff;border:1px solid #4c6980;border-radius:8px;padding:7px 10px;font:11px system-ui;box-shadow:0 4px 20px #0008" role="note">Prévia local • dados de teste • sem conexão com produção<br><a style="color:#70d7ff" href="/admin?scenario=filled&role=${role}">Preenchido</a> · <a style="color:#70d7ff" href="/admin?scenario=empty&role=${role}">Vazio</a> · <a style="color:#70d7ff" href="/admin?scenario=error&role=${role}">Erro</a> · <a style="color:#70d7ff" href="/admin?scenario=slow&role=${role}">Lento</a> · <a style="color:#70d7ff" href="/admin?scenario=${scenario}&role=${role === "viewer" ? "admin" : "viewer"}">${role === "viewer" ? "Administrador" : "Somente leitura"}</a></aside>`;
        const recovery = scenario === "error" ? '<button id="qaRecover" style="position:fixed;bottom:135px;right:10px;z-index:99999;background:#172536;color:white;padding:8px;border:1px solid #4c6980;border-radius:8px" onclick="fetch(\'/__qa/recover\').then(()=>this.textContent=\'API local recuperada; use Tentar novamente\')">Recuperar API de teste</button>' : '';
        response = new Response((await response.text()).replace("</body>", banner + recovery + "</body>"), { status: response.status, headers: response.headers });
      }
    }
    res.writeHead(response.status, { ...Object.fromEntries(response.headers), "set-cookie": [`qa_scenario=${scenario}; Path=/; SameSite=Strict`, `qa_role=${role}; Path=/; SameSite=Strict`] });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`Local preview error: ${error.message}`);
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Local QA preview: http://127.0.0.1:${port}/admin?scenario=filled&role=admin`));
