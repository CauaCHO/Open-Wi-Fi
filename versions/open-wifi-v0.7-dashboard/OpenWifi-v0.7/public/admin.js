const brl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const dateFmt = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'});
let lastData = null;
const esc = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => ts ? dateFmt.format(new Date(ts)) : '—';

function metric(label,value,sub='') { return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></article>`; }
function renderMetrics(d){
  const m=d.metrics;
  document.querySelector('#metrics').innerHTML = [
    metric('Conectados agora',m.connectedNow,`${m.paidOnlineNow} com acesso pago`),
    metric('Compras hoje',m.purchasesToday,brl.format(m.grossToday)),
    metric('Faturamento do mês',brl.format(m.grossMonth),`${m.purchasesMonth} compras`),
    metric('Lucro estimado',brl.format(m.estimatedProfitMonth),`taxas ${brl.format(m.estimatedFeesMonth)} • custos ${brl.format(m.monthlyFixedCost)}`),
    metric('Acessos pagos ativos',m.activePaidAccesses,'inclui clientes offline')
  ].join('');
}
function statusHtml(c){
  if(c.online&&c.paidActive) return '<span class="pill good">Online • pago</span>';
  if(c.online) return '<span class="pill warn">Online</span>';
  if(c.paidActive) return '<span class="pill info">Pago • offline</span>';
  return '<span class="pill">Offline</span>';
}
function renderClients(){
  if(!lastData) return;
  const q=document.querySelector('#clientSearch').value.toLowerCase().trim();
  const list=lastData.clients.filter(c=>!q||[c.hostname,c.mac,c.ip,c.email,c.plan].some(v=>String(v).toLowerCase().includes(q)));
  document.querySelector('#clientsBody').innerHTML = list.length ? list.map(c=>`<tr>
    <td>${statusHtml(c)}</td><td><strong>${esc(c.hostname)}</strong></td>
    <td><div>${esc(c.ip)}</div><code>${esc(c.mac)}</code></td><td>${esc(c.email)}</td><td>${esc(c.plan)}</td><td>${fmtDate(c.accessUntil)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum dispositivo encontrado.</td></tr>';
}
function renderPurchases(d){
  document.querySelector('#purchasesBody').innerHTML = d.purchases.length ? d.purchases.map(p=>`<tr>
    <td>${fmtDate(p.approvedAt)}</td><td><strong>${esc(p.hostname)}</strong><br><code>${esc(p.mac)}</code></td><td>${esc(p.email)}</td><td>${esc(p.plan)}</td><td>${brl.format(p.amount)}</td><td>${fmtDate(p.accessUntil)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhuma compra aprovada ainda.</td></tr>';
}
async function load(){
  const btn=document.querySelector('#refreshBtn'); btn.disabled=true;
  try{
    const r=await fetch('/api/admin/dashboard',{cache:'no-store'});
    if(r.status===401){ location.href='/admin-login.html'; return; }
    const d=await r.json(); if(!r.ok) throw new Error(d.error||'Falha ao carregar painel');
    lastData=d; renderMetrics(d); renderClients(); renderPurchases(d);
    document.querySelector('#updatedAt').textContent=`Atualizado ${fmtDate(d.generatedAt)} • ${d.timezone}`;
    const rs=document.querySelector('#routerStatus'); rs.textContent=d.router.online?`RB online • ${d.router.connectedHosts} hosts`:'RB offline'; rs.className=`status-chip ${d.router.online?'online':'offline'}`;
    if(d.router.error) rs.title=d.router.error;
  }catch(e){ document.querySelector('#updatedAt').textContent=`Erro: ${e.message}`; }
  finally{ btn.disabled=false; }
}
document.querySelector('#refreshBtn').onclick=load;
document.querySelector('#clientSearch').addEventListener('input',renderClients);
document.querySelector('#logoutBtn').onclick=async()=>{await fetch('/api/admin/logout',{method:'POST'}); location.href='/admin-login.html';};
load(); setInterval(load,5000);
