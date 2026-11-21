import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import ts from 'typescript';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bundle = await rolldown({
  input: path('./normalize.ts'),
  platform: 'neutral',
});
try {
  const { output: [entry] } = await bundle.generate({ format: 'iife', name: 'DashboardHooks' });
  // Rhino does not parse all the syntax supported by the Node build.
  const { outputText } = ts.transpileModule(entry.code, {
    fileName: 'normalize.js',
    compilerOptions: { target: ts.ScriptTarget.ES5 },
  });
  await mkdir(path('./build/assets/'), { recursive: true });
  await writeFile(path('./build/assets/normalize.js'), outputText);
} finally {
  await bundle.close();
}
