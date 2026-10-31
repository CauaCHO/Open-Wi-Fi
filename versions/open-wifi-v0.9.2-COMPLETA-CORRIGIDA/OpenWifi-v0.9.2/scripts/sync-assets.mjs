import { access, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'newlogo.png');
const targets = [
  path.join(root, 'public', 'newlogo.png'),
  path.join(root, 'firebase-dashboard', 'newlogo.png')
];

try {
  await access(source);
  const bytes = await readFile(source);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
  if (!png) throw new Error('newlogo.png existe, mas não parece ser um PNG válido.');
  for (const target of targets) await copyFile(source, target);
  console.log('[assets] newlogo.png sincronizada para portal e painel Firebase ✓');
} catch (error) {
  console.warn(`[assets] ${error.message || 'newlogo.png não encontrada.'}`);
  console.warn('[assets] Coloque sua imagem como newlogo.png na raiz do projeto.');
}
