import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const document=(await readFile(new URL('docs/LLM_INSTALLATION.md',root),'utf8')).replaceAll('\r\n','\n');
const prompt=document.split('<!-- access-kit-prompt:start -->\n```text\n')[1]?.split('\n```\n<!-- access-kit-prompt:end -->')[0];
if(!prompt)throw Error('Canonical installation prompt markers are missing');
await writeFile(new URL('src/llm-instructions-source.ts',root),'// Generated from docs/LLM_INSTALLATION.md; run node scripts/build-llm-instructions.mjs.\nexport const llmInstallationInstructions='+JSON.stringify(prompt)+';\n');
