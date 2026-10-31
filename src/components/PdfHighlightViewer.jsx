import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Character width estimation for sub-string highlighting
 */
function getCharWeight(ch) {
  if ('ijlI1.:;!,|/\'"`()[]{}'.includes(ch)) return 0.45;
  if ('mwMW@%#&'.includes(ch)) return 1.35;
  if ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(ch)) return 1.15;
  if (' '.includes(ch)) return 0.5;
  return 0.85;
}

function getSubstringOffsets(fullStr, startIdx, matchLen, totalWidth) {
  if (!fullStr || fullStr.length === 0) {
    return { offsetLeft: 0, matchWidth: totalWidth };
  }

  let totalWeight = 0;
  for (let i = 0; i < fullStr.length; i++) {
    totalWeight += getCharWeight(fullStr[i]);
  }
  if (totalWeight <= 0) totalWeight = 1;

  let beforeWeight = 0;
  for (let i = 0; i < startIdx && i < fullStr.length; i++) {
    beforeWeight += getCharWeight(fullStr[i]);
  }

  let matchWeight = 0;
  for (let i = startIdx; i < startIdx + matchLen && i < fullStr.length; i++) {
    matchWeight += getCharWeight(fullStr[i]);
  }

  const offsetLeft = (beforeWeight / totalWeight) * totalWidth;
  const matchWidth = Math.max(14, (matchWeight / totalWeight) * totalWidth);

  return { offsetLeft, matchWidth };
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getQueryRegex(query) {
  if (!query || !query.trim()) return null;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words.map(escapeRegex).join('\\s+');
  return new RegExp(pattern, 'gi');
}

function buildPageTextMap(items) {
  let text = '';
  const ranges = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const str = item.str || '';
    if (!str) continue;

    const start = text.length;
    text += str;
    const end = text.length;

    ranges.push({
      item,
      start,
      end,
    });

    text += ' ';
  }

  return { text, ranges };
}

/**
 * PdfHighlightViewer.jsx
 * Chrome-Style Exact In-Document PDF Highlighter
 * Controlled entirely by dashboard header search bar.
 * Matches full phrases accurately across consecutive PDF text fragments.
 */
export default function PdfHighlightViewer({
  url,
  searchKeyword = '',
  currentMatchIdx = 0,
  onMatchesFound = null,
}) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading document...');
  const [error, setError] = useState(null);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagesData, setPagesData] = useState([]);
  const [allMatches, setAllMatches] = useState([]);
  const [zoomScale, setZoomScale] = useState(1.45);
  const pdfDocRef = useRef(null);
  const renderTasksRef = useRef([]);

  // 1. Fetch and Load PDF Document
  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      if (!url) return;
      setLoading(true);
      setLoadingMsg('Loading document...');
      setError(null);

      try {
        let attempts = 0;
        while (!window.pdfjsLib && attempts < 30) {
          await new Promise((r) => setTimeout(r, 100));
          attempts++;
        }

        if (!window.pdfjsLib) {
          throw new Error('PDF.js library is not available. Please verify internet connectivity.');
        }

        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        let buffer;
        if (url.startsWith('data:application/pdf;base64,')) {
          const base64Data = url.split(',')[1];
          const binaryStr = window.atob(base64Data);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else {
          setLoadingMsg('Downloading PDF binary...');
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: Could not load PDF binary`);
          buffer = await resp.arrayBuffer();
        }

        if (isCancelled) return;

        setLoadingMsg('Rendering pages...');
        const doc = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setTotalPages(doc.numPages || 1);
        setCurrentPage(1);
      } catch (err) {
        if (!isCancelled) {
          console.error('PDF load error:', err);
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
      pdfDocRef.current = null;
    };
  }, [url]);

  // 2. Scan and Index Matches across the entire document using exact phrase regex
  useEffect(() => {
    let isCancelled = false;

    async function indexAllMatches() {
      const doc = pdfDocRef.current;
      const cleanQuery = (searchKeyword || '').trim();

      if (!doc || !cleanQuery) {
        setAllMatches([]);
        if (typeof onMatchesFound === 'function') {
          onMatchesFound([]);
        }
        return;
      }

      const matchesList = [];
      let globalId = 0;
      const maxPages = Math.min(doc.numPages, 150);

      for (let p = 1; p <= maxPages; p++) {
        if (isCancelled) return;

        try {
          const page = await doc.getPage(p);
          const textContent = await page.getTextContent();
          const items = textContent.items || [];
          const { text } = buildPageTextMap(items);

          const queryRegex = getQueryRegex(cleanQuery);
          if (!queryRegex) continue;

          let m;
          while ((m = queryRegex.exec(text)) !== null) {
            matchesList.push({
              id: globalId++,
              pageNum: p,
              snippet: text.substring(
                Math.max(0, m.index - 20),
                Math.min(text.length, m.index + m[0].length + 20)
              ),
            });

            if (m.index === queryRegex.lastIndex) {
              queryRegex.lastIndex++;
            }
          }

          if (p % 10 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        } catch (e) {
          // ignore scan error
        }
      }

      if (isCancelled) return;
      setAllMatches(matchesList);
      if (typeof onMatchesFound === 'function') {
        onMatchesFound(matchesList);
      }
    }

    indexAllMatches();

    return () => {
      isCancelled = true;
    };
  }, [totalPages, searchKeyword]);

  // When active match changes, switch active page if large doc
  useEffect(() => {
    if (allMatches.length > 0 && allMatches[currentMatchIdx]) {
      const targetPage = allMatches[currentMatchIdx].pageNum;
      if (totalPages > 20 && targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
    }
  }, [currentMatchIdx, allMatches, totalPages]);

  // 3. Render pages and calculate exact phrase highlights across items
  useEffect(() => {
    let isCancelled = false;

    async function renderPages() {
      const doc = pdfDocRef.current;
      if (!doc) return;

      try {
        const isHuge = doc.numPages > 20;
        const pageNumbers = isHuge
          ? [currentPage]
          : Array.from({ length: doc.numPages }, (_, i) => i + 1);

        const pages = [];
        const cleanQuery = (searchKeyword || '').trim();

        for (const pageNum of pageNumbers) {
          if (isCancelled) return;

          let matchCounter = allMatches.filter((m) => m.pageNum < pageNum).length;

          const page = await doc.getPage(pageNum);
          const viewport = page.getViewport({ scale: zoomScale });
          const textContent = await page.getTextContent();
          const items = textContent.items || [];
          const pageMatches = [];

          if (cleanQuery) {
            const { text, ranges } = buildPageTextMap(items);
            const queryRegex = getQueryRegex(cleanQuery);

            if (queryRegex) {
              let m;
              while ((m = queryRegex.exec(text)) !== null) {
                const matchStart = m.index;
                const matchEnd = m.index + m[0].length;
                const currentId = matchCounter++;

                // Highlight all items that overlap with this phrase match
                for (const range of ranges) {
                  const overlapStart = Math.max(range.start, matchStart);
                  const overlapEnd = Math.min(range.end, matchEnd);

                  if (overlapStart < overlapEnd) {
                    const startInItem = overlapStart - range.start;
                    const lenInItem = overlapEnd - overlapStart;

                    const item = range.item;
                    const tx = item.transform[4];
                    const ty = item.transform[5];
                    const fontH = Math.abs(item.height || item.transform[3] || 12);
                    const fontW = Math.abs(item.width || 40);

                    const rect = viewport.convertToViewportRectangle([
                      tx,
                      ty - fontH * 0.15,
                      tx + fontW,
                      ty + fontH * 0.85,
                    ]);

                    const itemLeft = Math.min(rect[0], rect[2]);
                    const itemTop = Math.min(rect[1], rect[3]);
                    const itemWidth = Math.abs(rect[2] - rect[0]);
                    const itemHeight = Math.abs(rect[3] - rect[1]);

                    const { offsetLeft, matchWidth } = getSubstringOffsets(
                      item.str,
                      startInItem,
                      lenInItem,
                      itemWidth
                    );

                    pageMatches.push({
                      id: currentId,
                      pageNum,
                      left: Math.max(0, itemLeft + offsetLeft - 2),
                      top: Math.max(0, itemTop - 1),
                      width: Math.max(14, matchWidth + 4),
                      height: Math.max(12, itemHeight + 2),
                      snippet: item.str,
                    });
                  }
                }

                if (m.index === queryRegex.lastIndex) {
                  queryRegex.lastIndex++;
                }
              }
            }
          }

          pages.push({
            pageNum,
            page,
            viewport,
            matches: pageMatches,
          });
        }

        if (isCancelled) return;

        setPagesData(pages);
        setLoading(false);
      } catch (err) {
        if (!isCancelled) {
          console.error('Page render error:', err);
          setError(err.message || 'Error rendering page');
          setLoading(false);
        }
      }
    }

    renderPages();

    return () => {
      isCancelled = true;
    };
  }, [totalPages, currentPage, searchKeyword, zoomScale, allMatches]);

  // 4. Render HTML5 Canvas with High-DPI / Retina Crisp Scaling
  useEffect(() => {
    renderTasksRef.current.forEach((t) => {
      try {
        if (t && typeof t.cancel === 'function') t.cancel();
      } catch (e) {}
    });
    renderTasksRef.current = [];

    pagesData.forEach(({ page, viewport, pageNum }) => {
      const canvas = document.getElementById(`pdf-canvas-${pageNum}`);
      if (!canvas) return;

      const dpr = Math.max(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext('2d', { alpha: false });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderContext = {
        canvasContext: context,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      };

      const task = page.render(renderContext);
      task.promise.catch((err) => {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Canvas render error:', err);
        }
      });
      renderTasksRef.current.push(task);
    });

    return () => {
      renderTasksRef.current.forEach((t) => {
        try {
          if (t && typeof t.cancel === 'function') t.cancel();
        } catch (e) {}
      });
      renderTasksRef.current = [];
    };
  }, [pagesData]);

  // 5. Smooth Auto-Scroll to Active Match (exact Chrome behavior)
  useEffect(() => {
    if (allMatches.length === 0) return;
    const matchEl = document.getElementById(`pdf-match-${currentMatchIdx}`);
    if (matchEl) {
      matchEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }, [currentMatchIdx, allMatches, pagesData]);

  const handleZoomIn = () => setZoomScale((prev) => Math.min(2.5, +(prev + 0.15).toFixed(2)));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(0.75, +(prev - 0.15).toFixed(2)));
  const handleZoomReset = () => setZoomScale(1.45);

  if (loading) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#64748b',
          backgroundColor: '#525659',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          className="spinner"
          style={{ borderTopColor: '#38bdf8', width: '36px', height: '36px', marginBottom: '14px' }}
        />
        <p style={{ fontSize: '12pt', color: '#f1f5f9', margin: 0, fontWeight: 500 }}>
          {loadingMsg}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '50px 20px',
          color: '#ef4444',
          backgroundColor: '#525659',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ fontSize: '13pt', fontWeight: 600, marginBottom: '8px', color: '#fca5a5' }}>{error}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#525659',
        overflow: 'hidden',
        fontFamily: 'Calibri, sans-serif',
      }}
    >
      {/* Floating Zoom Controls at Bottom-Right */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '24px',
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: 'rgba(30, 41, 59, 0.85)',
          backdropFilter: 'blur(4px)',
          borderRadius: '20px',
          padding: '4px 10px',
          color: '#ffffff',
          fontSize: '9.5pt',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          onClick={handleZoomOut}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '12pt',
            padding: '0 4px',
          }}
          title="Zoom Out"
        >
          −
        </button>
        <span onClick={handleZoomReset} style={{ cursor: 'pointer', minWidth: '40px', textAlign: 'center' }}>
          {Math.round(zoomScale * 100)}%
        </span>
        <button
          type="button"
          onClick={handleZoomIn}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '12pt',
            padding: '0 4px',
          }}
          title="Zoom In"
        >
          +
        </button>
      </div>

      {/* Pages Container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          padding: '24px 16px 60px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {pagesData.map(({ pageNum, viewport, matches }) => (
          <div
            key={pageNum}
            id={`pdf-page-container-${pageNum}`}
            style={{
              position: 'relative',
              width: `${viewport.width}px`,
              height: `${viewport.height}px`,
              backgroundColor: '#ffffff',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.45)',
              borderRadius: '2px',
            }}
          >
            {/* HTML5 Canvas */}
            <canvas
              id={`pdf-canvas-${pageNum}`}
              style={{
                width: `${viewport.width}px`,
                height: `${viewport.height}px`,
                display: 'block',
              }}
            />

            {/* Exact Chrome-Style Highlights */}
            {matches.map((m, idx) => {
              const isActive = m.id === currentMatchIdx;
              return (
                <div
                  key={idx}
                  id={`pdf-match-${m.id}`}
                  title={`Match (Page ${m.pageNum})`}
                  style={{
                    position: 'absolute',
                    left: `${m.left}px`,
                    top: `${m.top}px`,
                    width: `${m.width}px`,
                    height: `${m.height}px`,
                    // Soft transparent highlighter with multiply blend mode so words stay 100% clear and sharp
                    backgroundColor: isActive
                      ? 'rgba(56, 189, 248, 0.35)'
                      : 'rgba(254, 240, 138, 0.45)',
                    border: isActive
                      ? '1px solid rgba(2, 132, 199, 0.7)'
                      : '1px solid rgba(234, 179, 8, 0.45)',
                    boxShadow: isActive
                      ? '0 0 6px rgba(56, 189, 248, 0.35)'
                      : 'none',
                    borderRadius: '2px',
                    pointerEvents: 'none',
                    mixBlendMode: 'multiply',
                    zIndex: isActive ? 15 : 10,
                    transition: 'all 0.15s ease',
                  }}
                />
              );
            })}

            {/* Page number badge */}
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                right: '12px',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '9pt',
                userSelect: 'none',
              }}
            >
              Page {pageNum} of {totalPages}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
