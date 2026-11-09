import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { NotConnectedButton } from '@/components/not-connected-button';
import { Button } from '@/components/ui/button';
import { DEFAULT_API_BASE_URL } from '@/lib/api-client';

const FALLBACK_FILENAME = 'sales-report.xlsx';

/** File name from the server's Content-Disposition header, reduced to a safe set of characters. */
function filenameFrom(response) {
  const match = /filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition') ?? '');
  const name = match ? match[1].replace(/[^A-Za-z0-9._-]/g, '') : '';
  return name.endsWith('.xlsx') ? name : FALLBACK_FILENAME;
}

async function failureMessage(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === 'string') return payload.error.message;
  } catch {
    // Not a JSON error body; use the generic message below.
  }
  return 'The Excel file could not be downloaded.';
}

/**
 * Downloads the Excel workbook of a saved, completed report. The server builds it from the saved
 * snapshot; it never refreshes data from GAAP.
 */
export function ExportAction({ status, reportId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (status !== 'completed' || !reportId) {
    return (
      <NotConnectedButton icon={FileSpreadsheet} reason="Needs a completed report">
        Download Excel
      </NotConnectedButton>
    );
  }

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${DEFAULT_API_BASE_URL}/reports/${reportId}/export`);
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(response);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Unable to reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={download}>
        {busy ? (
          <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
        ) : (
          <FileSpreadsheet size={16} strokeWidth={1.75} aria-hidden="true" />
        )}
        {busy ? 'Preparing…' : 'Download Excel'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
