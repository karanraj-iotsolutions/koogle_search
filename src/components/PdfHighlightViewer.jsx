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

/**
 * PdfHighlightViewer.jsx
 * Chrome-Style In-Document PDF Highlighter & Floating Find Bar
 * Matches Chrome's exact search pattern:
 * - Floating Find Bar: [ input ] [ 1/5 ] [ ▲ ] [ ▼ ] [ ✕ ]
 * - Yellow highlights for all matching words (rgba(255, 235, 59, 0.7))
 * - Vibrant sky-blue highlight for active match (rgba(56, 189, 248, 0.85))
 * - Auto-scrolls smoothly to center active match
 */
export default function PdfHighlightViewer({
  url,
  initialKeyword = '',
}) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagesData, setPagesData] = useState([]);
  const [allMatches, setAllMatches] = useState([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState(initialKeyword || '');
  const [zoomScale, setZoomScale] = useState(1.45);
  const pdfDocRef = useRef(null);
  const renderTasksRef = useRef([]);
  const searchInputRef = useRef(null);

  // 1. Fetch and Load PDF Document
  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      if (!url) return;
      setLoading(true);
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

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: Could not load PDF binary`);
        const buffer = await resp.arrayBuffer();

        if (isCancelled) return;

        const doc = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setLoading(false);
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

  // 2. Scan Pages and Calculate Exact Character-Level Highlights
  useEffect(() => {
    let isCancelled = false;

    async function indexHighlights() {
      const doc = pdfDocRef.current;
      if (!doc) return;

      try {
        const pages = [];
        const matchesList = [];
        let globalMatchId = 0;

        const cleanQuery = (searchKeyword || '').trim().toLowerCase();
        const spacelessQuery = cleanQuery.replace(/\s+/g, '');

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          if (isCancelled) return;

          const page = await doc.getPage(pageNum);
          const viewport = page.getViewport({ scale: zoomScale });
          const textContent = await page.getTextContent();
          const items = textContent.items || [];
          const pageMatches = [];

          if (cleanQuery) {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const str = item.str || '';
              if (!str.trim()) continue;

              const lowerStr = str.toLowerCase();
              let startIndex = 0;

              // A. Match ALL direct occurrences in item.str (finds multiple words on same line)
              while (startIndex < lowerStr.length) {
                const matchPos = lowerStr.indexOf(cleanQuery, startIndex);
                if (matchPos === -1) break;

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

                // Calculate exact sub-string coordinates
                const { offsetLeft, matchWidth } = getSubstringOffsets(
                  str,
                  matchPos,
                  cleanQuery.length,
                  itemWidth
                );

                const left = Math.max(0, itemLeft + offsetLeft - 2);
                const top = Math.max(0, itemTop - 1);
                const width = Math.max(14, matchWidth + 4);
                const height = Math.max(12, itemHeight + 2);

                const matchObj = {
                  id: globalMatchId++,
                  pageNum,
                  left,
                  top,
                  width,
                  height,
                  snippet: str,
                };

                pageMatches.push(matchObj);
                matchesList.push(matchObj);

                startIndex = matchPos + cleanQuery.length;
              }

              // B. Spaceless Matching (e.g. user typed "karanraj" for "KARAN RAJ")
              if (
                cleanQuery.length >= 4 &&
                !lowerStr.includes(cleanQuery)
              ) {
                const spacelessStr = lowerStr.replace(/\s+/g, '');
                if (spacelessStr.includes(spacelessQuery)) {
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

                  const left = Math.max(0, Math.min(rect[0], rect[2]) - 2);
                  const top = Math.max(0, Math.min(rect[1], rect[3]) - 1);
                  const width = Math.max(14, Math.abs(rect[2] - rect[0]) + 4);
                  const height = Math.max(12, Math.abs(rect[3] - rect[1]) + 2);

                  const matchObj = {
                    id: globalMatchId++,
                    pageNum,
                    left,
                    top,
                    width,
                    height,
                    snippet: str,
                  };

                  pageMatches.push(matchObj);
                  matchesList.push(matchObj);
                }
              }
            }

            // C. Compound Multi-Item Check (e.g. "KARAN" and "RAJ" separated as 2 items)
            if (spacelessQuery.length >= 4) {
              for (let i = 0; i < items.length - 1; i++) {
                const it1 = items[i];
                const it2 = items[i + 1];
                const pairStr = ((it1.str || '') + ' ' + (it2.str || '')).toLowerCase();
                const spacelessPair = pairStr.replace(/\s+/g, '');

                if (
                  spacelessPair.includes(spacelessQuery) &&
                  !it1.str?.toLowerCase().includes(cleanQuery) &&
                  !it2.str?.toLowerCase().includes(cleanQuery)
                ) {
                  for (const itm of [it1, it2]) {
                    const tx = itm.transform[4];
                    const ty = itm.transform[5];
                    const fontH = Math.abs(itm.height || itm.transform[3] || 12);
                    const fontW = Math.abs(itm.width || 40);

                    const rect = viewport.convertToViewportRectangle([
                      tx,
                      ty - fontH * 0.15,
                      tx + fontW,
                      ty + fontH * 0.85,
                    ]);

                    const left = Math.max(0, Math.min(rect[0], rect[2]) - 2);
                    const top = Math.max(0, Math.min(rect[1], rect[3]) - 1);
                    const width = Math.max(14, Math.abs(rect[2] - rect[0]) + 4);
                    const height = Math.max(12, Math.abs(rect[3] - rect[1]) + 2);

                    const matchObj = {
                      id: globalMatchId++,
                      pageNum,
                      left,
                      top,
                      width,
                      height,
                      snippet: itm.str,
                    };

                    pageMatches.push(matchObj);
                    matchesList.push(matchObj);
                  }
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
        setAllMatches(matchesList);
        setCurrentMatchIdx(0);
      } catch (err) {
        if (!isCancelled) {
          console.error('Highlight indexing error:', err);
        }
      }
    }

    indexHighlights();

    return () => {
      isCancelled = true;
    };
  }, [loading, searchKeyword, zoomScale]);

  // 3. Render Canvas elements safely
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

      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport,
      };

      const task = page.render(renderContext);
      task.promise.catch((err) => {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Canvas render info:', err);
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

  // 4. Auto-Scroll smooth to current active match
  useEffect(() => {
    if (allMatches.length === 0) return;
    const activeEl = document.getElementById(`pdf-match-${currentMatchIdx}`);
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }, [currentMatchIdx, allMatches]);

  // Match Navigation
  const goToNextMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    setCurrentMatchIdx((prev) => (prev + 1) % allMatches.length);
  }, [allMatches.length]);

  const goToPrevMatch = useCallback(() => {
    if (allMatches.length === 0) return;
    setCurrentMatchIdx((prev) => (prev - 1 + allMatches.length) % allMatches.length);
  }, [allMatches.length]);

  const handleClearSearch = useCallback(() => {
    setSearchKeyword('');
    setAllMatches([]);
    setCurrentMatchIdx(0);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      handleClearSearch();
    }
  };

  const handleZoomIn = () => setZoomScale((prev) => Math.min(2.5, +(prev + 0.2).toFixed(2)));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(0.8, +(prev - 0.2).toFixed(2)));
  const handleZoomReset = () => setZoomScale(1.45);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
        <div className="spinner" style={{ margin: '0 auto 12px auto', borderTopColor: '#0f172a' }} />
        <p style={{ fontSize: '11pt', margin: 0 }}>Rendering pages & indexing keywords...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#ef4444' }}>
        <p style={{ fontSize: '12pt', marginBottom: '8px' }}>{error}</p>
        <p style={{ fontSize: '10.5pt', color: '#64748b' }}>Please try opening the document in a new tab.</p>
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
      }}
    >
      {/* Floating Chrome-Style Find Bar (Matches User Screenshot Exactly) */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '24px',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
          border: '1px solid #cbd5e1',
          padding: '4px 6px 4px 10px',
          gap: '4px',
          fontFamily: 'Calibri, sans-serif',
        }}
      >
        <input
          ref={searchInputRef}
          type="text"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in document..."
          style={{
            border: 'none',
            outline: 'none',
            fontSize: '11pt',
            width: '160px',
            color: '#0f172a',
            backgroundColor: 'transparent',
            padding: '2px 4px',
          }}
          autoFocus
        />

        {/* Counter: e.g. 5/5 or 1/5 */}
        <span
          style={{
            fontSize: '10pt',
            color: allMatches.length > 0 ? '#334155' : '#94a3b8',
            padding: '0 8px',
            borderLeft: '1px solid #e2e8f0',
            userSelect: 'none',
            minWidth: '42px',
            textAlign: 'center',
          }}
        >
          {allMatches.length > 0
            ? `${currentMatchIdx + 1}/${allMatches.length}`
            : searchKeyword.trim()
            ? '0/0'
            : ''}
        </span>

        {/* Previous Match (Up Arrow ^) */}
        <button
          type="button"
          onClick={goToPrevMatch}
          disabled={allMatches.length === 0}
          style={{
            background: 'none',
            border: 'none',
            cursor: allMatches.length > 0 ? 'pointer' : 'default',
            padding: '4px 6px',
            borderRadius: '4px',
            color: allMatches.length > 0 ? '#1e293b' : '#cbd5e1',
            fontSize: '11pt',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Previous match (Shift+Enter or Up)"
        >
          ▲
        </button>

        {/* Next Match (Down Arrow v) */}
        <button
          type="button"
          onClick={goToNextMatch}
          disabled={allMatches.length === 0}
          style={{
            background: 'none',
            border: 'none',
            cursor: allMatches.length > 0 ? 'pointer' : 'default',
            padding: '4px 6px',
            borderRadius: '4px',
            color: allMatches.length > 0 ? '#1e293b' : '#cbd5e1',
            fontSize: '11pt',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Next match (Enter or Down)"
        >
          ▼
        </button>

        {/* Close Button x */}
        <button
          type="button"
          onClick={handleClearSearch}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '4px',
            color: '#64748b',
            fontSize: '11pt',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Clear search"
        >
          ✕
        </button>
      </div>

      {/* Bottom Floating Zoom Controls */}
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

            {/* Highlights Overlay: Yellow for normal matches, Chrome Sky-Blue for active match */}
            {matches.map((m) => {
              const isActive = m.id === currentMatchIdx;
              return (
                <div
                  key={m.id}
                  id={`pdf-match-${m.id}`}
                  title={`Match: "${m.snippet}" (Page ${m.pageNum})`}
                  style={{
                    position: 'absolute',
                    left: `${m.left}px`,
                    top: `${m.top}px`,
                    width: `${m.width}px`,
                    height: `${m.height}px`,
                    // Exact Chrome Highlighting Style:
                    // Active match is sky-blue (#38bdf8 / #70b5f9), other matches are warm yellow
                    backgroundColor: isActive
                      ? 'rgba(56, 189, 248, 0.85)' // Chrome vibrant sky-blue
                      : 'rgba(255, 235, 59, 0.7)', // Warm vibrant yellow
                    border: isActive
                      ? '1.5px solid #0284c7'
                      : '1px solid rgba(234, 179, 8, 0.85)',
                    boxShadow: isActive
                      ? '0 0 10px rgba(14, 165, 233, 0.75)'
                      : '0 0 3px rgba(250, 204, 21, 0.4)',
                    borderRadius: '2px',
                    pointerEvents: 'none',
                    zIndex: 10,
                    transition: 'all 0.12s ease',
                  }}
                />
              );
            })}

            {/* Page indicator */}
            <div
              style={{
                position: 'absolute',
                bottom: '-20px',
                right: '4px',
                fontSize: '8.5pt',
                color: '#cbd5e1',
                userSelect: 'none',
              }}
            >
              Page {pageNum} of {pagesData.length}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
