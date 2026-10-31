import assert from "node:assert/strict";
import worker from "../src/index.js";

async function fetchPage(path) {
  const response = await worker.fetch(new Request(`https://openwifi.invalid${path}`), {}, {});
  assert.equal(response.status, 200, `${path}: resposta inesperada`);
  return response.text();
}

function validatePage(name, html) {
  const ids = [...html.matchAll(/\sid=(["'])([^"']+)\1/gi)].map(match => match[2]);
  const idSet = new Set(ids);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `${name}: IDs duplicados: ${duplicates.join(", ")}`);

  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, `${name}: nenhum script encontrado`);
  scripts.forEach((script, index) => {
    try {
      Function(script);
    } catch (error) {
      error.message = `${name}: script ${index + 1} inválido: ${error.message}`;
      throw error;
    }
  });

  const literalLookups = scripts.flatMap(script => [...script.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]));
  const missingLookups = [...new Set(literalLookups.filter(id => !idSet.has(id)))];
  assert.deepEqual(missingLookups, [], `${name}: seletores sem elemento: ${missingLookups.join(", ")}`);

  const linkedAttributes = ["data-tab", "data-jump", "data-focus", "aria-labelledby", "aria-describedby", "aria-controls", "for"];
  for (const attribute of linkedAttributes) {
    const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, "gi");
    const targets = [...html.matchAll(pattern)].flatMap(match => match[1].trim().split(/\s+/));
    const missing = [...new Set(targets.filter(id => !idSet.has(id)))];
    assert.deepEqual(missing, [], `${name}: ${attribute} aponta para elemento ausente: ${missing.join(", ")}`);
  }

  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const unnamedButtons = buttons.flatMap(match => {
    const attributes = match[1];
    const visibleText = match[2].replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
    const named = /\baria-label=["'][^"']+["']/i.test(attributes) || /\btitle=["'][^"']+["']/i.test(attributes) || visibleText;
    if (named) return [];
    const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1];
    return [id || attributes.trim().slice(0, 80) || "<button>"];
  });
  assert.deepEqual(unnamedButtons, [], `${name}: botões sem nome acessível: ${unnamedButtons.join(", ")}`);

  const domains = [...html.matchAll(/\sdata-domain=["']([^"']+)["']/gi)].map(match => match[1]);
  const domainPanels = new Set([...html.matchAll(/\sdata-domain-panel=["']([^"']+)["']/gi)].map(match => match[1]));
  const missingDomainPanels = [...new Set(domains.filter(domain => !domainPanels.has(domain)))];
  assert.deepEqual(missingDomainPanels, [], `${name}: áreas sem painel contextual: ${missingDomainPanels.join(", ")}`);

  return { ids: ids.length, scripts: scripts.length, lookups: literalLookups.length, buttons: buttons.length };
}

const landing = validatePage("Site institucional", await fetchPage("/"));
const admin = validatePage("Painel administrativo", await fetchPage("/admin"));
const portal = validatePage("Portal do cliente", await fetchPage("/portal"));

console.log(
  `Validação de interfaces concluída: ${landing.ids + admin.ids + portal.ids} IDs, ` +
  `${landing.scripts + admin.scripts + portal.scripts} scripts, ${landing.lookups + admin.lookups + portal.lookups} referências e ` +
  `${landing.buttons + admin.buttons + portal.buttons} botões conferidos.`
);
