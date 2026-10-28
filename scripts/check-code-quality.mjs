import { codeQualityFindings } from './code-quality-findings.mjs';

const findings = await codeQualityFindings(process.cwd());
for (const finding of findings)
  console.error(`${finding.file}: ${finding.label} [${finding.signature}]`);
if (findings.length) process.exitCode = 1;
else
  console.log(
    'Code contracts: complexity ≤20, nesting ≤4 and exported function/class JSDoc; no exceptions.',
  );
