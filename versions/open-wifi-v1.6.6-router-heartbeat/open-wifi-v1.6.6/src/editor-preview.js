export const editorStyles = `
.portal-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,370px);gap:20px;align-items:start}.portal-editor-fields{min-width:0}.portal-editor-fields .card{margin-bottom:16px}.portal-preview-panel{position:sticky;top:86px;border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:20px}.portal-preview-head{display:flex;align-items:start;justify-content:space-between;gap:8px;margin-bottom:18px}.portal-preview-head h2{font-size:17px;margin:0 0 4px}.editor-state{border-radius:99px;padding:5px 8px;color:#a9e9ff;background:#153245;border:1px solid #26556b;font-size:11px;white-space:nowrap}.editor-state.dirty{color:#ffe0a3;background:#3a2912;border-color:#75582a}.phone-frame{max-width:300px;min-height:510px;margin:auto;border:6px solid #2c3946;border-radius:34px;background:#080b10;box-shadow:0 22px 50px #0008;padding:17px 12px;overflow:hidden}.phone-speaker{width:70px;height:5px;border-radius:5px;background:#30404e;margin:0 auto 17px}.phone-screen{border-radius:22px;color:#f5f7fa;text-align:center}.phone-screen img{width:54px;height:54px;object-fit:contain;border-radius:13px;background:#132635;padding:3px}.phone-screen h3{font-size:19px;line-height:1.15;letter-spacing:-.04em;margin:12px 0 6px;overflow-wrap:anywhere}.phone-screen p{font-size:11px;line-height:1.5;color:#a6b4c2;margin:0 auto 16px;max-width:230px;overflow-wrap:anywhere}.phone-panel{background:#11161d;border:1px solid #252d38;border-radius:13px;padding:12px;text-align:left}.phone-panel b{font-size:12px}.phone-notice{color:#f6d597;background:#352819;border:1px solid #5a4327;border-radius:9px;padding:8px;margin-bottom:10px;font-size:10px;overflow-wrap:anywhere}.phone-plan{border:1px solid #354452;border-radius:8px;background:#19222d;margin-top:8px;padding:9px;display:flex;justify-content:space-between;gap:8px;font-size:10px}.phone-plan strong{font-weight:700}.phone-plan em{font-style:normal;color:#85dfff;white-space:nowrap}.phone-empty{font-size:10px;color:#9caabb;margin-top:10px}.phone-foot{font-size:9px;color:#7c8d9d;margin-top:12px}.portal-preview-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.portal-preview-actions .btn{flex:1}.preview-note{font-size:11px;color:var(--muted);margin-top:13px}.portal-editor-fields .actions{position:sticky;bottom:0;z-index:3;background:linear-gradient(180deg,transparent,var(--bg) 25%);padding:15px 0 3px}@media(max-width:1150px){.portal-editor-layout{grid-template-columns:minmax(0,1fr) 290px}}@media(max-width:850px){.portal-editor-layout{display:flex;flex-direction:column}.portal-editor-fields,.portal-preview-panel{width:100%}.portal-preview-panel{position:static}.phone-frame{min-height:470px}.portal-editor-fields .actions{position:static}}@media(max-width:420px){.portal-preview-panel{padding:14px}.phone-frame{max-width:100%}}
`;

export const editorMarkup = `
<aside class="portal-preview-panel" id="editorPreviewPanel" aria-label="Prévia do portal Wi-Fi">
  <div class="portal-preview-head"><div><h2>Prévia do portal</h2><div class="muted">Marca e planos do estabelecimento atual.</div></div><span class="editor-state" id="editorState">Configuração publicada</span></div>
  <div class="phone-frame"><div class="phone-speaker" aria-hidden="true"></div><div class="phone-screen" id="editorPhone"><img id="editorLogo" src="/assets/site-logo?site=openwifi-main" alt="Logo configurado"><h3 id="editorTitle">Open Wi-Fi</h3><p id="editorSubtitle">A página que o visitante verá na rede.</p><div class="phone-panel"><div class="phone-notice hidden" id="editorNotice"></div><b>Planos disponíveis</b><div id="editorPlans" role="status"><div class="phone-empty">Carregando planos cadastrados…</div></div></div><div class="phone-foot">Powered by Open Wi-Fi</div></div></div>
  <div class="portal-preview-actions"><button class="btn" id="viewPortalPreview" type="button">Ver prévia</button><button class="btn ghost" id="restorePortalDefaults" type="button">Restaurar textos padrão</button></div>
  <p class="preview-note">Prévia local. As alterações de texto só chegam ao portal após Salvar portal. Imagens enviadas são publicadas no momento do upload.</p>
</aside>`;

export const editorScript = `
(()=>{
  const fieldIds=["portalTitle","portalSubtitle","supportWhatsapp","aboutTitle","aboutText","bgMode","bgUrl","logoUrl","requireWhatsappStandard","noticeEnabled","noticeTitle","noticeText","noticeStart","noticeEnd","emergencyMessage","privacyTitle","privacyText","privacyRequire"];
  const get=id=>document.getElementById(id);
  let published="";
  let plansLoaded=false;
  function snapshot(){return JSON.stringify(fieldIds.map(id=>{const el=get(id);return el?.type==="checkbox"?el.checked:el?.value}))}
  function updateState(){const dirty=published&&snapshot()!==published;get("editorState").textContent=dirty?"Alterações não salvas":"Configuração publicada";get("editorState").classList.toggle("dirty",!!dirty)}
  function render(){
    get("editorTitle").textContent=get("portalTitle").value.trim()||"Open Wi-Fi";
    get("editorSubtitle").textContent=get("portalSubtitle").value.trim()||"Escolha um plano para acessar a internet.";
    const showNotice=get("noticeEnabled").checked&&!!(get("noticeTitle").value.trim()||get("noticeText").value.trim());
    get("editorNotice").classList.toggle("hidden",!showNotice);
    get("editorNotice").textContent=[get("noticeTitle").value.trim(),get("noticeText").value.trim()].filter(Boolean).join(" · ");
    get("editorLogo").src=get("logoPreview").src;
    updateState();
  }
  async function loadRealPlans(){
    if(plansLoaded)return;
    const target=get("editorPlans");
    target.replaceChildren();
    const loading=document.createElement("div");loading.className="phone-empty";loading.textContent="Carregando planos cadastrados…";target.append(loading);
    try{
      const r=await fetch("/api/admin/plans",{credentials:"same-origin"});
      if(!r.ok)throw new Error("Planos indisponíveis");
      const d=await r.json();
      const items=(d.plans||[]).filter(p=>p.enabled).slice(0,3);
      target.replaceChildren();
      if(!items.length){const empty=document.createElement("div");empty.className="phone-empty";empty.textContent="Nenhum plano ativo cadastrado.";target.append(empty)}
      for(const plan of items){const row=document.createElement("div");row.className="phone-plan";const name=document.createElement("strong");name.textContent=plan.name;const price=document.createElement("em");price.textContent=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(plan.price_cents||0)/100);row.append(name,price);target.append(row)}
      plansLoaded=true;
    }catch{target.replaceChildren();const error=document.createElement("div");error.className="phone-empty";error.textContent="Não foi possível carregar os planos. Abra esta área novamente para tentar.";target.append(error)}
  }
  fieldIds.forEach(id=>{get(id)?.addEventListener("input",render);get(id)?.addEventListener("change",render)});
  document.querySelectorAll('[data-tab="portal"]').forEach(button=>button.addEventListener("click",()=>{render();loadRealPlans()}));
  get("viewPortalPreview").addEventListener("click",()=>{get("editorPreviewPanel").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});get("editorPreviewPanel").focus({preventScroll:true})});
  get("editorPreviewPanel").tabIndex=-1;
  get("restorePortalDefaults").addEventListener("click",()=>{get("portalTitle").value="Open Wi-Fi";get("portalSubtitle").value="Escolha seu acesso, pague via Pix e conecte.";get("aboutTitle").value="Conheça o Open Wi-Fi";get("aboutText").value="";get("bgMode").value="gradient";get("noticeEnabled").checked=false;get("noticeTitle").value="";get("noticeText").value="";render()});
  window.syncPortalPreview=(markPublished=false)=>{if(markPublished)published=snapshot();render()};
  window.loadEditorPlans=loadRealPlans;
  render();
})();
`;
