import { useState } from 'react';
import { command } from './command-client';
export function useScanExports(setError: (message: string) => void) {
  const [pseudonymize, setPseudonymize] = useState(false);
  const download = (body: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportJob = async (id: string, html = false) => {
    try {
      const report = await command(html ? 'EXPORT_HTML' : 'EXPORT', {
        id,
        pseudonymize,
      });
      download(
        html ? String(report) : JSON.stringify(report, null, 2),
        `epi-less-${id}.${html ? 'html' : 'json'}`,
        html ? 'text/html;charset=utf-8' : 'application/json',
      );
    } catch (cause) {
      setError(String(cause));
    }
  };
  const exportHistory = async (origin?: string) => {
    try {
      const report = await command('EXPORT_HISTORY', { origin, pseudonymize });
      download(
        JSON.stringify(report, null, 2),
        `epi-less-${origin ? 'site' : 'index'}.json`,
        'application/json',
      );
    } catch (cause) {
      setError(String(cause));
    }
  };
  return { pseudonymize, setPseudonymize, exportJob, exportHistory };
}
