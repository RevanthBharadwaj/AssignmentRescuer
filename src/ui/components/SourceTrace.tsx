import type { Provenance } from '../../core/types';

const METHOD: Record<Provenance['extractionMethod'], string> = {
  deterministic_text: 'text parser',
  manual_entry: 'typed by you',
  ocr: 'OCR',
  vision_model: 'vision model',
  document_parser: 'document parser',
  structured_parser: 'structured data parser',
  ai_model: 'AI model',
};

export function SourceTrace({ provenance, compact = false }: { provenance: Provenance[]; compact?: boolean }) {
  return (
    <details className={compact ? 'trace compact' : 'trace'}>
      <summary>{compact ? 'source' : 'Source'}{provenance.length > 1 ? `s (${provenance.length})` : ''}</summary>
      <ul>
        {provenance.map((p, i) => (
          <li key={`${p.sourceId}-${i}`}>
            <div>
              <strong>{p.originalName}</strong>
              <span className="muted small">
                {' '}· imported {new Date(p.importedAt).toLocaleString()} · {METHOD[p.extractionMethod]}
                {p.page !== null && ` · page ${p.page}`}
                {p.textLocation && ` · line ${p.textLocation.line}`}
                {' '}· {p.verificationStatus} · {p.confirmationStatus}
              </span>
            </div>
            {p.excerpt && <blockquote>{p.excerpt}</blockquote>}
          </li>
        ))}
      </ul>
    </details>
  );
}
