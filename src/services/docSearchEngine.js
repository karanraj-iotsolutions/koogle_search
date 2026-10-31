/**
 * docSearchEngine.js
 * In-browser Full-Text Document Indexing and Search Engine for Koogle Search
 * Uses IndexedDB to cache extracted text from 100+ PDFs, Word, Excel, and Text files.
 */

const DB_NAME = 'KoogleDocIndexDB';
const DB_VERSION = 1;
const STORE_NAME = 'doc_contents';

// In-memory memory cache
const memoryCache = new Map();

/**
 * Open IndexedDB
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/**
 * Get cached document text from IndexedDB
 */
export async function getCachedDocText(id) {
  if (memoryCache.has(id)) {
    return memoryCache.get(id);
  }
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          memoryCache.set(id, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Save document text to IndexedDB & memory cache
 */
export async function saveCachedDocText(id, data) {
  memoryCache.set(id, data);
  const db = await openDB();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, ...data });
  } catch (e) {
    // Ignore storage quota errors
  }
}

/**
 * Extract full text from a document (PDF, Word, Excel, Text)
 */
export async function extractDocumentText(doc, getDocumentUrl) {
  if (!doc || !doc.s3Key) return null;

  // Check cache first
  const cached = await getCachedDocText(doc.id);
  if (cached) return cached;

  try {
    const url = await getDocumentUrl(doc.s3Key, 'view');
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const buffer = await resp.arrayBuffer();
    const ext = (doc.fileName || '').split('.').pop().toLowerCase();

    let fullText = '';
    const pages = [];

    // 1. PDF Documents
    if (ext === 'pdf' && window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const pageStr = textContent.items.map((i) => i.str).join(' ');
        pages.push({ pageNum: p, text: pageStr });
      }
      fullText = pages.map((p) => p.text).join('\n');
    }
    // 2. Word Documents (.docx)
    else if (ext === 'docx' && window.mammoth) {
      const res = await window.mammoth.extractRawText({ arrayBuffer: buffer });
      fullText = res.value || '';
      pages.push({ pageNum: 1, text: fullText });
    }
    // 3. Excel Spreadsheets (.xlsx, .xls)
    else if (['xlsx', 'xls', 'csv'].includes(ext) && window.XLSX) {
      const workbook = window.XLSX.read(buffer, { type: 'array' });
      const sheetTexts = [];
      workbook.SheetNames.forEach((name) => {
        const sheet = workbook.Sheets[name];
        const csv = window.XLSX.utils.sheet_to_csv(sheet);
        sheetTexts.push(csv);
      });
      fullText = sheetTexts.join('\n');
      pages.push({ pageNum: 1, text: fullText });
    }
    // 4. Text and Data files (.txt, .log, .json, .xml)
    else if (['txt', 'log', 'json', 'xml', 'html', 'htm', 'csv'].includes(ext)) {
      const decoder = new TextDecoder('utf-8');
      fullText = decoder.decode(buffer);
      pages.push({ pageNum: 1, text: fullText });
    }

    if (fullText) {
      const result = { fullText, pages };
      await saveCachedDocText(doc.id, result);
      return result;
    }
  } catch (err) {
    console.warn(`Extraction error for doc ${doc.fileName || doc.id}:`, err);
  }

  return null;
}

/**
 * Search inside an extracted document text
 */
export function searchDocContent(docTextObj, query) {
  if (!docTextObj || !docTextObj.fullText || !query) return null;

  const q = query.trim().toLowerCase();
  const fullText = docTextObj.fullText;
  const lowerFull = fullText.toLowerCase();

  // 1. Direct match
  let foundIdx = lowerFull.indexOf(q);

  // 2. Spaceless match (e.g. "karanraj" inside "karan raj" or part of email)
  let isSpaceless = false;
  if (foundIdx === -1 && q.length >= 4) {
    const spacelessQuery = q.replace(/\s+/g, '');
    const spacelessText = lowerFull.replace(/\s+/g, '');
    if (spacelessText.includes(spacelessQuery)) {
      isSpaceless = true;
      foundIdx = 0; // mark matched
    }
  }

  if (foundIdx === -1) return null;

  // Determine which page contains the match
  let matchedPageNum = 1;
  let snippet = '';

  if (docTextObj.pages && docTextObj.pages.length > 0) {
    for (const page of docTextObj.pages) {
      const pageLower = page.text.toLowerCase();
      let pIdx = pageLower.indexOf(q);
      if (pIdx === -1 && isSpaceless) {
        if (pageLower.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) {
          pIdx = 0;
        }
      }
      if (pIdx !== -1) {
        matchedPageNum = page.pageNum;
        const start = Math.max(0, pIdx - 35);
        const end = Math.min(page.text.length, pIdx + q.length + 45);
        snippet = (start > 0 ? '...' : '') +
          page.text.substring(start, end).trim() +
          (end < page.text.length ? '...' : '');
        break;
      }
    }
  }

  if (!snippet) {
    const start = Math.max(0, foundIdx - 35);
    const end = Math.min(fullText.length, foundIdx + q.length + 45);
    snippet = (start > 0 ? '...' : '') +
      fullText.substring(start, end).trim() +
      (end < fullText.length ? '...' : '');
  }

  return {
    matchedPageNum,
    snippet,
  };
}

