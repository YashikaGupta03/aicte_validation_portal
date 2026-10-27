import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { apiBlob } from '../api.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// The AI service renders PDF pages at RENDER_DPI and reports bbox as [x0, y0, x1, y1] in those pixels.
// We render with the same scale, so the canvas pixel size equals the AI service's page size and no
// page width/height has to come from the API. For images, bbox is in the image's natural pixels.
const RENDER_DPI = Number(import.meta.env.VITE_RENDER_DPI || 150);

const SEV_COLOR = { high: '#dc2626', medium: '#d97706', low: '#2563eb' };

/**
 * doc:        { id, filename, mime }
 * highlights: [{ id, page, bbox, severity, label }]  (boxes for this document)
 * activeId:   id of the highlight to emphasise
 * page/onPage: controlled current page (1-based)
 */
export default function EvidenceViewer({ doc, highlights, activeId, page, onPage }) {
  const [state, setState] = useState({ status: 'loading' });
  const [size, setSize] = useState(null); // rendered pixel size of the current page
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const isPdf = doc.mime === 'application/pdf';

  // Load the file once per document
  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setState({ status: 'loading' });
    setSize(null);
    pdfRef.current = null;
    (async () => {
      try {
        const blob = await apiBlob(`/api/documents/${doc.id}/file`);
        if (cancelled) return;
        if (isPdf) {
          const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
          if (cancelled) return;
          pdfRef.current = pdf;
          setState({ status: 'ready', pages: pdf.numPages });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setState({ status: 'ready', pages: 1, imageUrl: objectUrl });
        }
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err.message });
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, isPdf]);

  // Render the current PDF page
  useEffect(() => {
    if (state.status !== 'ready' || !isPdf || !pdfRef.current) return undefined;
    let cancelled = false;
    let task;
    (async () => {
      const pdfPage = await pdfRef.current.getPage(Math.min(Math.max(page, 1), state.pages));
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: RENDER_DPI / 72 });
      const canvas = canvasRef.current;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      setSize({ w: canvas.width, h: canvas.height });
      task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
      await task.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [state, page, isPdf]);

  if (state.status === 'loading') return <p className="t">Loading document…</p>;
  if (state.status === 'error') return <p role="alert" className="wn">{state.message}</p>;

  const visible = highlights.filter((h) => (h.page || 1) === page && Array.isArray(h.bbox) && h.bbox.length === 4);
  const unplaced = highlights.filter((h) => !(Array.isArray(h.bbox) && h.bbox.length === 4));

  return (
    <div>
      <div className="r" style={{ gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <b>{doc.filename}</b>
        {state.pages > 1 && <>
          <button className="btn bo" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
          <span className="t">Page {page} of {state.pages}</span>
          <button className="btn bo" disabled={page >= state.pages} onClick={() => onPage(page + 1)}>Next</button>
        </>}
      </div>
      <div style={{ position: 'relative', maxWidth: 900, border: '1px solid #e2e8f0', lineHeight: 0 }}>
        {isPdf
          ? <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
          : <img src={state.imageUrl} alt={doc.filename} style={{ width: '100%', display: 'block' }}
                 onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        {size && visible.map((h) => {
          const [x0, y0, x1, y1] = h.bbox;
          const color = SEV_COLOR[h.severity] || '#dc2626';
          const active = h.id === activeId;
          return (
            <div key={h.id} title={h.label} style={{
              position: 'absolute',
              left: `${(x0 / size.w) * 100}%`, top: `${(y0 / size.h) * 100}%`,
              width: `${((x1 - x0) / size.w) * 100}%`, height: `${((y1 - y0) / size.h) * 100}%`,
              border: `${active ? 3 : 2}px solid ${color}`,
              background: `${color}${active ? '33' : '1a'}`,
              boxShadow: active ? `0 0 0 3px ${color}55` : 'none',
              pointerEvents: 'none',
            }} />
          );
        })}
      </div>
      {unplaced.length > 0 && <p className="t" style={{ marginTop: 8 }}>
        {unplaced.length} flag(s) on this document have no location (document-level finding).
      </p>}
    </div>
  );
}
