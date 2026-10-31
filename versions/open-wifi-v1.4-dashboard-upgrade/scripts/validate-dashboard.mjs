import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

function extractStaticPage(signature) {
  const functionStart = source.indexOf(signature);
  assert.notEqual(functionStart, -1, `Função não encontrada: ${signature}`);
  const marker = "return `";
  const templateStart = source.indexOf(marker, functionStart);
  assert.notEqual(templateStart, -1, `Template não encontrado: ${signature}`);
  const contentStart = templateStart + marker.length;

  let escaped = false;
  for (let index = contentStart; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`" && source[index + 1] === ";") {
      const raw = source.slice(contentStart, index);
      assert.equal(raw.includes("${"), false, `${signature} não pode interpolar dados no HTML estático`);
      return Function(`"use strict"; return \`${raw}\`;`)();
    }
  }
  assert.fail(`Fim do template não encontrado: ${signature}`);
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

  const linkedAttributes = ["data-tab", "data-jump", "data-focus", "aria-labelledby", "aria-describedby"];
  for (const attribute of linkedAttributes) {
    const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, "gi");
    const targets = [...html.matchAll(pattern)].map(match => match[1]);
    const missing = [...new Set(targets.filter(id => !idSet.has(id)))];
    assert.deepEqual(missing, [], `${name}: ${attribute} aponta para elemento ausente: ${missing.join(", ")}`);
  }

  return { ids: ids.length, scripts: scripts.length, lookups: literalLookups.length };
}

const admin = validatePage("Painel administrativo", extractStaticPage("function adminPage(){"));
const portal = validatePage("Portal do cliente", extractStaticPage("function portalPage(env) {"));

console.log(
  `Validação visual estática concluída: ${admin.ids + portal.ids} IDs, ` +
  `${admin.scripts + portal.scripts} scripts e ${admin.lookups + portal.lookups} referências conferidas.`
);
