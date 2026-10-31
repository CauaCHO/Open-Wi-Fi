import { access, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'newlogo.png');
const targets = [
  path.join(root, 'public', 'newlogo.png'),
  path.join(root, 'firebase-dashboard', 'newlogo.png')
];

try {
  await access(source);
  for (const target of targets) await copyFile(source, target);
  console.log('[assets] newlogo.png sincronizada para portal e painel Firebase ✓');
} catch {
  console.warn('[assets] newlogo.png não encontrada na raiz. Copie sua logo para:', source);
}
