import React, { useState, useEffect, useMemo } from 'react';
import './dashboard_page.css';
import {
  getDocuments,
  uploadDocument,
  updateDocument,
  getDocumentUrl,
  deleteDocument,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../services/api';
import {
  extractDocumentText,
  searchDocContent,
  getCachedDocText,
} from '../services/docSearchEngine';
import PdfHighlightViewer from './PdfHighlightViewer';

/**
 * Highlights matching query terms with <mark> tags
 */
function highlightText(text, query) {
  if (!text || !query || !query.trim()) return text;
  const q = query.trim();
  const str = String(text);
  const lowerStr = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  const matchIndex = lowerStr.indexOf(lowerQ);

  if (matchIndex === -1) return text;

  const before = str.substring(0, matchIndex);
  const match = str.substring(matchIndex, matchIndex + q.length);
  const after = str.substring(matchIndex + q.length);

  return (
    <>
      {before}
      <mark className="search-match-mark">{match}</mark>
      {highlightText(after, query)}
    </>
  );
}

const DEFAULT_DOCUMENTS = [
  {
    id: 'mock-1',
    date: '2026-10-14',
    issuer: 'Ministry of Finance',
    circularNo: 'CIR/2026/FIN-104',
    subject: 'Quarterly Financial Statement Guidelines',
    remarks: 'Mandatory filing by end of Q3',
    fileName: 'Q3_Financial_Stmt.pdf',
    s3Key: null,
  },
  {
    id: 'mock-2',
    date: '2026-10-13',
    issuer: 'Reserve Authority',
    circularNo: 'RA/2026-27/88',
    subject: 'Vendor Partnership & Cloud Security Agreement',
    remarks: 'Signed service level contract',
    fileName: 'Vendor_Agreement.pdf',
    s3Key: null,
  },
  {
    id: 'mock-3',
    date: '2026-10-12',
    issuer: 'Dept. of Product & IT',
    circularNo: 'IT-PR-412/A',
    subject: 'Product Roadmap & Release Scope 2026',
    remarks: 'Sprint priorities for mobile release',
    fileName: 'Product_Roadmap.pdf',
    s3Key: null,
  },
  {
    id: 'mock-4',
    date: '2026-10-10',
    issuer: 'Human Resources Directorate',
    circularNo: 'HR/CIR-09/2026',
    subject: 'Employee Policy Handbook v4.2',
    remarks: 'Updated remote work & benefits',
    fileName: 'Employee_Handbook.pdf',
    s3Key: null,
  },
];

const AVAILABLE_PERMISSIONS = [
  { id: 'upload', label: 'Upload' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'download', label: 'Download' },
  { id: 'share', label: 'Share' },
];

export default function DashboardPage({
  user = 'admin',
  role = 'super_admin',
  access = ['upload', 'edit', 'delete', 'download', 'share'],
  onLogout,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState(DEFAULT_DOCUMENTS);
  const [backendConnected, setBackendConnected] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);

  const [showUserModal, setShowUserModal] = useState(false);
  const [userList, setUserList] = useState([]);
  const [userLoading, setUserLoading] = useState(false);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [previewModal, setPreviewModal] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [excelSheets, setExcelSheets] = useState([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [wordHtml, setWordHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pdfKeyword, setPdfKeyword] = useState('');
  const [pdfSearchTerm, setPdfSearchTerm] = useState('');
  const [pdfSearchUrl, setPdfSearchUrl] = useState('');
  const [loadedPdfDoc, setLoadedPdfDoc] = useState(null);
  const [pdfSearchResults, setPdfSearchResults] = useState([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [pdfSearching, setPdfSearching] = useState(false);
  const [pdfSearchMessage, setPdfSearchMessage] = useState('');
  const [docIndexMap, setDocIndexMap] = useState({});
  const [pdfViewerMode, setPdfViewerMode] = useState('highlight');

  // New Document state
  const [newDoc, setNewDoc] = useState({
    date: new Date().toISOString().split('T')[0],
    issuer: '',
    circularNo: '',
    subject: '',
    remarks: '',
  });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState('');

  // New User state
  const [newUser, setNewUser] = useState({
    email: '',
    username: '',
    password: '',
    role: 'admin',
    access: ['upload', 'download'],
  });

  // Permissions calculation
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'admin' || isSuperAdmin;
  const canUpload = isSuperAdmin || access.includes('upload');
  const canEdit = isSuperAdmin || access.includes('edit');
  const canDelete = isSuperAdmin || access.includes('delete');
  const canDownload = isSuperAdmin || access.includes('download');
  const canShare = isSuperAdmin || access.includes('share');

  // Background full-text indexing for all documents
  const indexDocuments = async (docs) => {
    for (const d of docs) {
      if (!d.s3Key) continue;
      getCachedDocText(d.id).then((cached) => {
        if (cached) {
          setDocIndexMap((prev) => ({ ...prev, [d.id]: cached }));
        } else {
          extractDocumentText(d, getDocumentUrl).then((extracted) => {
            if (extracted) {
              setDocIndexMap((prev) => ({ ...prev, [d.id]: extracted }));
            }
          });
        }
      });
    }
  };

  // Load documents on mount
  useEffect(() => {
    loadBackendDocuments();
  }, []);

  const loadBackendDocuments = async () => {
    try {
      const items = await getDocuments();
      if (Array.isArray(items) && items.length > 0) {
        setDocuments(items);
        indexDocuments(items);
      }
      setBackendConnected(true);
    } catch (err) {
      setBackendConnected(false);
    }
  };

  // Filter documents based on metadata AND extracted document content!
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return documents.map((doc) => ({
        doc,
        isContentMatch: false,
        snippet: '',
        pageNum: 1,
      }));
    }

    const q = searchQuery.trim().toLowerCase();

    return documents
      .map((doc) => {
        // 1. Metadata match
        const metaMatch =
          (doc.issuer || '').toLowerCase().includes(q) ||
          (doc.circularNo || '').toLowerCase().includes(q) ||
          (doc.subject || '').toLowerCase().includes(q) ||
          (doc.remarks || '').toLowerCase().includes(q) ||
          (doc.fileName || '').toLowerCase().includes(q) ||
          (doc.date || '').includes(q);

        // 2. Full-text Content Match inside PDF / Word / Excel / Text
        const docText = docIndexMap[doc.id];
        const contentMatch = searchDocContent(docText, q);

        if (metaMatch || contentMatch) {
          return {
            doc,
            isContentMatch: !!contentMatch,
            snippet: contentMatch ? contentMatch.snippet : '',
            pageNum: contentMatch ? contentMatch.matchedPageNum : 1,
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [documents, searchQuery, docIndexMap]);

  // Load users when opening user modal
  const handleOpenUserModal = async () => {
    if (!isAdmin) return;
    setShowUserModal(true);
    setUserLoading(true);
    try {
      const users = await getUsers();
      setUserList(users);
    } catch (err) {
      console.warn('Could not load users:', err);
    } finally {
      setUserLoading(false);
    }
  };

  // Handle Enter key in the main Koogle search bar -> Auto Open first matching document!
  const handleMainSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults.length > 0 && searchQuery.trim()) {
        const topResult = searchResults[0];
        handlePreview(topResult.doc, searchQuery.trim(), topResult.pageNum);
      }
    }
  };

  // Document: Upload (Supports Multiple Files)
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!newDoc.issuer.trim() || !newDoc.circularNo.trim()) {
      alert('Please fill in Issuer and Circular No.');
      return;
    }

    if (selectedFiles.length === 0 && !newDoc.subject.trim()) {
      alert('Please enter a Subject or attach at least one file.');
      return;
    }

    setIsUploading(true);

    try {
      const filesToUpload = selectedFiles.length > 0 ? selectedFiles : [null];
      const newlyCreatedDocs = [];

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        if (filesToUpload.length > 1) {
          setUploadProgress(`Uploading ${i + 1} of ${filesToUpload.length}: ${file.name}...`);
        } else {
          setUploadProgress('Uploading to S3...');
        }

        let docSubject = newDoc.subject.trim();
        if (file) {
          const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          if (!docSubject) {
            docSubject = nameWithoutExt;
          } else if (filesToUpload.length > 1) {
            docSubject = `${newDoc.subject} (${file.name})`;
          }
        } else if (!docSubject) {
          docSubject = 'Untitled Document';
        }

        const docCircularNo =
          filesToUpload.length > 1 && newDoc.circularNo
            ? `${newDoc.circularNo}/${i + 1}`
            : newDoc.circularNo;

        const formData = new FormData();
        formData.append('date', newDoc.date);
        formData.append('issuer', newDoc.issuer);
        formData.append('circularNo', docCircularNo);
        formData.append('subject', docSubject);
        formData.append('remarks', newDoc.remarks || '-');
        if (file) {
          formData.append('file', file);
        }

        try {
          const created = await uploadDocument(formData);
          newlyCreatedDocs.push(created);
        } catch (err) {
          console.warn('Backend upload notice, using local fallback:', err);
          const localRecord = {
            id: 'local-' + Date.now() + '-' + i,
            date: newDoc.date,
            issuer: newDoc.issuer,
            circularNo: docCircularNo,
            subject: docSubject,
            remarks: newDoc.remarks || '-',
            fileName: file ? file.name : 'Document.pdf',
            s3Key: null,
          };
          newlyCreatedDocs.push(localRecord);
        }
      }

      setDocuments((prev) => [...newlyCreatedDocs, ...prev]);
      setShowUploadModal(false);
      resetUploadForm();
      alert(`Successfully uploaded ${newlyCreatedDocs.length} document${newlyCreatedDocs.length > 1 ? 's' : ''}!`);
    } catch (err) {
      console.error('Batch Upload Error:', err);
      alert('Upload failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const resetUploadForm = () => {
    setNewDoc({
      date: new Date().toISOString().split('T')[0],
      issuer: '',
      circularNo: '',
      subject: '',
      remarks: '',
    });
    setSelectedFiles([]);
    setUploadProgress('');
  };

  // Document: Edit
  const handleEditClick = (doc) => {
    setEditingDoc({ ...doc });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingDoc) return;

    try {
      const updated = await updateDocument(editingDoc.id, {
        date: editingDoc.date,
        issuer: editingDoc.issuer,
        circularNo: editingDoc.circularNo,
        subject: editingDoc.subject,
        remarks: editingDoc.remarks,
      });

      setDocuments((prev) =>
        prev.map((d) => (d.id === editingDoc.id ? { ...d, ...updated } : d))
      );
      setShowEditModal(false);
      setEditingDoc(null);
    } catch (err) {
      // Local fallback
      setDocuments((prev) =>
        prev.map((d) => (d.id === editingDoc.id ? { ...d, ...editingDoc } : d))
      );
      setShowEditModal(false);
      setEditingDoc(null);
      alert('Document updated locally.');
    }
  };

  // Document: Delete
  const handleDelete = async (id, s3Key) => {
    if (!window.confirm('Are you sure you want to delete this document record?')) {
      return;
    }

    try {
      await deleteDocument(id, s3Key);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    }
  };

  const getFileType = (filename) => {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['xlsx', 'xls'].includes(ext)) return 'excel';
    if (['docx', 'doc'].includes(ext)) return 'word';
    if (['txt', 'csv', 'log', 'json', 'xml'].includes(ext)) return 'text';
    if (['ppt', 'pptx'].includes(ext)) return 'office';
    return 'other';
  };

  // Document: Preview
  const handlePreview = async (doc, initialKeyword = '', targetPage = 1) => {
    if (!doc.s3Key) {
      alert(`Previewing sample file: ${doc.fileName}`);
      return;
    }

    try {
      const url = await getDocumentUrl(doc.s3Key, 'view');
      const fileType = getFileType(doc.fileName);
      setPreviewModal({
        url,
        doc,
        fileType,
        viewerEngine: 'google',
      });
      setPreviewLoading(true);
      setPreviewError('');
      setExcelSheets([]);
      setActiveSheetIndex(0);
      setWordHtml('');
      setTextContent('');
      setPdfKeyword(initialKeyword);
      setPdfSearchTerm(initialKeyword);
      setLoadedPdfDoc(null);
      setPdfSearchResults([]);
      setCurrentMatchIdx(0);
      setPdfSearchMessage('');

      const baseUrl = url.split('#')[0];
      if (initialKeyword) {
        setPdfSearchUrl(`${baseUrl}#page=${targetPage}&view=FitH`);
      } else {
        setPdfSearchUrl(`${baseUrl}#toolbar=1&navpanes=0&view=FitH`);
      }

      if (fileType === 'pdf') {
        if (window.pdfjsLib) {
          fetch(url)
            .then((r) => r.arrayBuffer())
            .then((buffer) => {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
              return window.pdfjsLib.getDocument({ data: buffer }).promise;
            })
            .then(async (pdf) => {
              setLoadedPdfDoc(pdf);
              if (initialKeyword) {
                await performSearchOnDoc(pdf, initialKeyword);
              }
            })
            .catch((e) => console.warn('PDF pre-index error:', e));
        }
      }

      if (fileType === 'excel') {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          const buffer = await resp.arrayBuffer();

          if (window.XLSX) {
            const workbook = window.XLSX.read(buffer, { type: 'array' });
            const sheets = workbook.SheetNames.map((sheetName) => {
              const worksheet = workbook.Sheets[sheetName];
              const html = window.XLSX.utils.sheet_to_html(worksheet, { id: 'excel-table' });
              return { name: sheetName, html };
            });
            setExcelSheets(sheets);
          } else {
            setPreviewError('Excel parser library not loaded. Please try again.');
          }
        } catch (err) {
          setPreviewError('Could not load Excel preview: ' + err.message);
        } finally {
          setPreviewLoading(false);
        }
      } else if (fileType === 'word') {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          const buffer = await resp.arrayBuffer();

          if (window.mammoth) {
            const result = await window.mammoth.convertToHtml({ arrayBuffer: buffer });
            setWordHtml(result.value);
          }
        } catch (err) {
          console.warn('Word in-browser parse error:', err);
        } finally {
          setPreviewLoading(false);
        }
      } else if (fileType === 'text') {
        try {
          const resp = await fetch(url);
          const text = await resp.text();
          setTextContent(text);
        } catch (err) {
          setPreviewError('Could not load text content: ' + err.message);
        } finally {
          setPreviewLoading(false);
        }
      } else {
        setPreviewLoading(false);
      }
    } catch (err) {
      alert('Could not open preview: ' + err.message);
    }
  };

  // PDF Keyword Search
  const performSearchOnDoc = async (doc, query) => {
    const results = [];
    const cleanQuery = query.toLowerCase();

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        const lowerText = pageText.toLowerCase();

        // 1. Direct substring match
        let startIndex = 0;
        let foundAny = false;
        while (startIndex < lowerText.length) {
          const foundIdx = lowerText.indexOf(cleanQuery, startIndex);
          if (foundIdx === -1) break;
          foundAny = true;

          const snippetStart = Math.max(0, foundIdx - 30);
          const snippetEnd = Math.min(lowerText.length, foundIdx + cleanQuery.length + 40);
          const snippet =
            (snippetStart > 0 ? '...' : '') +
            pageText.substring(snippetStart, snippetEnd).trim() +
            (snippetEnd < lowerText.length ? '...' : '');

          results.push({
            pageNum,
            snippet,
            matchText: cleanQuery,
          });

          startIndex = foundIdx + cleanQuery.length;
        }

        // 2. Fuzzy/Combined words match (e.g. user typed "karanraj" for "karan raj" or part of email)
        if (!foundAny && cleanQuery.length >= 4) {
          // Check if spaceless query matches spaceless text
          const spacelessPage = lowerText.replace(/\s+/g, '');
          const spacelessQuery = cleanQuery.replace(/\s+/g, '');
          if (spacelessPage.includes(spacelessQuery)) {
            const snippet =
              pageText.length > 80 ? pageText.substring(0, 80).trim() + '...' : pageText;
            results.push({
              pageNum,
              snippet,
              matchText: cleanQuery,
            });
          }
        }
      } catch (err) {
        console.warn(`Error scanning page ${pageNum}:`, err);
      }
    }

    setPdfSearchResults(results);
    setCurrentMatchIdx(0);

    if (results.length > 0) {
      setPdfSearchMessage(`${results.length} match${results.length > 1 ? 'es' : ''} found`);
      jumpToPdfMatch(results[0].pageNum);
    } else {
      setPdfSearchMessage(`No matches found for "${query}"`);
    }
  };

  const jumpToPdfMatch = (pageNum) => {
    if (!previewModal?.url) return;
    const baseUrl = previewModal.url.split('#')[0];
    setPdfSearchUrl(`${baseUrl}#page=${pageNum}&view=FitH`);
  };

  const handleNextMatch = () => {
    if (pdfSearchResults.length === 0) return;
    const nextIdx = (currentMatchIdx + 1) % pdfSearchResults.length;
    setCurrentMatchIdx(nextIdx);
    if (pdfViewerMode === 'native') {
      jumpToPdfMatch(pdfSearchResults[nextIdx].pageNum);
    }
  };

  const handlePrevMatch = () => {
    if (pdfSearchResults.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + pdfSearchResults.length) % pdfSearchResults.length;
    setCurrentMatchIdx(prevIdx);
    if (pdfViewerMode === 'native') {
      jumpToPdfMatch(pdfSearchResults[prevIdx].pageNum);
    }
  };

  const handleSearchPdf = async () => {
    const query = pdfKeyword.trim();
    if (!query) {
      handleClearPdfSearch();
      return;
    }

    setPdfSearchTerm(query);
    setCurrentMatchIdx(0);

    if (pdfViewerMode === 'native' && previewModal?.url) {
      const baseUrl = previewModal.url.split('#')[0];
      setPdfSearchUrl(`${baseUrl}#search=${encodeURIComponent(query)}&view=FitH`);
    }
  };

  const handleClearPdfSearch = () => {
    setPdfKeyword('');
    setPdfSearchTerm('');
    setPdfSearchResults([]);
    setPdfSearchMessage('');
    setCurrentMatchIdx(0);
    if (previewModal?.url) {
      const baseUrl = previewModal.url.split('#')[0];
      setPdfSearchUrl(`${baseUrl}#toolbar=1&navpanes=0&view=FitH`);
    }
  };

  // Document: Download
  const handleDownload = async (doc) => {
    if (!canDownload) {
      alert('You do not have download permission.');
      return;
    }

    if (doc.s3Key) {
      try {
        const url = await getDocumentUrl(doc.s3Key, 'download');
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.fileName || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        alert('Download error: ' + err.message);
      }
    } else {
      alert(`Downloading sample file: ${doc.fileName}`);
    }
  };

  // Document: Share
  const handleShare = async (doc) => {
    if (!canShare) {
      alert('You do not have share permission.');
      return;
    }

    if (doc.s3Key) {
      try {
        const url = await getDocumentUrl(doc.s3Key, 'view');
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          alert('Secure document link copied to clipboard!');
        } else {
          prompt('Copy this document link:', url);
        }
      } catch (err) {
        alert('Could not generate share link: ' + err.message);
      }
    } else {
      alert(`Share link created for: ${doc.subject}`);
    }
  };

  // User Management: Toggle Access Checkbox
  const handleTogglePermission = (permId) => {
    setNewUser((prev) => {
      const exists = prev.access.includes(permId);
      const updated = exists
        ? prev.access.filter((p) => p !== permId)
        : [...prev.access, permId];
      return { ...prev, access: updated };
    });
  };

  // User Management: Create User
  const handleCreateUserSubmit = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password) {
      alert('Please fill in username and password.');
      return;
    }

    try {
      const created = await createUser(newUser);
      setUserList((prev) => [created, ...prev]);
      setShowAddUserForm(false);
      setNewUser({
        email: '',
        username: '',
        password: '',
        role: 'admin',
        access: ['upload', 'download'],
      });
      alert(`User "${created.username}" created successfully in DynamoDB!`);
    } catch (err) {
      alert(err.message || 'Failed to create user');
    }
  };

  // User Management: Start Edit User
  const handleStartEditUser = (u) => {
    setEditingUser({
      username: u.username,
      email: u.email || '',
      password: '',
      role: u.role || 'user',
      access: u.role === 'super_admin'
        ? ['upload', 'edit', 'delete', 'download', 'share']
        : (Array.isArray(u.access) ? [...u.access] : ['upload', 'download']),
    });
    setShowAddUserForm(false);
  };

  // User Management: Toggle Access Checkbox for Edit
  const handleToggleEditPermission = (permId) => {
    setEditingUser((prev) => {
      if (!prev) return prev;
      const exists = prev.access.includes(permId);
      const updated = exists
        ? prev.access.filter((p) => p !== permId)
        : [...prev.access, permId];
      return { ...prev, access: updated };
    });
  };

  // User Management: Update User
  const handleUpdateUserSubmit = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const payload = {
        email: editingUser.email,
        role: editingUser.role,
        access:
          editingUser.role === 'super_admin'
            ? ['upload', 'edit', 'delete', 'download', 'share']
            : editingUser.access,
      };
      if (editingUser.password && editingUser.password.trim()) {
        payload.password = editingUser.password.trim();
      }

      const updated = await updateUser(editingUser.username, payload);
      setUserList((prev) =>
        prev.map((u) =>
          u.username === editingUser.username
            ? {
                ...u,
                email: updated.email !== undefined ? updated.email : editingUser.email,
                role: updated.role !== undefined ? updated.role : editingUser.role,
                access: updated.access !== undefined ? updated.access : editingUser.access,
              }
            : u
        )
      );
      setEditingUser(null);
      alert(`User "${editingUser.username}" updated successfully!`);
    } catch (err) {
      alert(err.message || 'Failed to update user');
    }
  };

  // User Management: Delete User
  const handleDeleteUser = async (targetUsername) => {
    if (
      !window.confirm(`Are you sure you want to delete user "${targetUsername}"?`)
    ) {
      return;
    }

    try {
      await deleteUser(targetUsername);
      setUserList((prev) => prev.filter((u) => u.username !== targetUsername));
      alert(`User "${targetUsername}" deleted.`);
    } catch (err) {
      alert(err.message || 'Failed to delete user');
    }
  };

  return (
    <div className="dashboard-container">
      {/* Top Navigation Bar */}
      <header className="dashboard-navbar">
        <div className="nav-brand">
          <div className="nav-logo-box">
            <svg
              className="nav-doc-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <span className="brand-name">DocPortal</span>
          <span
            style={{
              fontSize: '9.5pt',
              marginLeft: '8px',
              padding: '2px 8px',
              borderRadius: '10px',
              backgroundColor: backendConnected ? '#f0fdf4' : '#fffbeb',
              color: backendConnected ? '#15803d' : '#b45309',
              border: `1px solid ${backendConnected ? '#bbf7d0' : '#fef3c7'}`,
            }}
          >
            {backendConnected ? '● EC2 Online' : '○ Local Mode'}
          </span>
        </div>

        <div className="nav-actions">
          {/* User Badge - Clickable to open User Management */}
          <button
            type="button"
            className="user-badge-button"
            onClick={handleOpenUserModal}
            title={isAdmin ? 'Click to Manage Users & Permissions' : 'User Profile'}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>{user}</span>
            {isAdmin && <span className="settings-indicator">⚙️</span>}
          </button>

          {/* Upload Button - Hidden if user lacks upload permission */}
          {canUpload && (
            <button
              type="button"
              className="upload-btn"
              onClick={() => setShowUploadModal(true)}
            >
              + Upload Doc
            </button>
          )}

          {/* Logout Button */}
          <button
            type="button"
            className="logout-icon-btn"
            onClick={onLogout}
            title="Sign Out"
            aria-label="Sign Out"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="18"
              height="18"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="dashboard-content">
        {/* Center Logo */}
        <div className="center-hero">
          <h1 className="koogle-title">
            <span className="k-blue">K</span>
            <span className="o-red">o</span>
            <span className="o-yellow">o</span>
            <span className="g-blue">g</span>
            <span className="l-green">l</span>
            <span className="e-red">e</span>
            <span className="search-text"> Search</span>
          </h1>

          {/* Search Box */}
          <div className="search-bar-wrapper">
            <svg
              className="search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search documents by circular no, issuer, subject, date or inside PDF content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleMainSearchKeyDown}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Document Records Table Card */}
        <section className="records-card">
          <div className="records-header">
            <h2 className="records-title">Document Records</h2>
            <span className="items-badge">{searchResults.length} items</span>
          </div>

          <div className="table-responsive">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>SL</th>
                  <th style={{ width: '105px' }}>Date</th>
                  <th style={{ width: '170px' }}>Issuer</th>
                  <th style={{ width: '140px' }}>Circular No</th>
                  <th>Subject</th>
                  <th>Remarks</th>
                  <th style={{ width: '230px', textAlign: 'right' }}>Document</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-row">
                      No documents found matching "{searchQuery}"
                    </td>
                  </tr>
                ) : (
                  searchResults.map((item, idx) => {
                    const doc = item.doc;
                    const isMatched = !!searchQuery.trim();
                    const parityClass = idx % 2 === 0 ? 'row-even' : 'row-odd';
                    return (
                      <tr
                        key={doc.id || idx}
                        className={`${parityClass} ${isMatched ? 'search-matched-row' : ''}`}
                      >
                        <td className="col-sl">{idx + 1}</td>
                        <td className="col-date">{highlightText(doc.date, searchQuery)}</td>
                        <td className="col-issuer">{highlightText(doc.issuer, searchQuery)}</td>
                        <td className="col-circular">
                          <span className="circular-pill">{highlightText(doc.circularNo, searchQuery)}</span>
                        </td>
                        <td className="col-subject">
                          <div style={{ fontWeight: 'normal' }}>{highlightText(doc.subject, searchQuery)}</div>
                          {item.isContentMatch && item.snippet && (
                            <div
                              className="content-match-snippet"
                              onClick={() => handlePreview(doc, searchQuery, item.pageNum)}
                              title={`Matched inside file (Page ${item.pageNum}) - Click to open and highlight`}
                            >
                              <span className="match-tag">📄 In-file match (Pg {item.pageNum}):</span>
                              <span className="match-snippet-text">{highlightText(item.snippet, searchQuery)}</span>
                            </div>
                          )}
                        </td>
                        <td className="col-remarks">{highlightText(doc.remarks, searchQuery)}</td>
                        <td className="col-actions">
                          <div className="doc-action-group">
                            {/* File Pill */}
                            <span
                              className="file-pill"
                              title={doc.fileName}
                              onClick={() => handlePreview(doc, searchQuery, item.pageNum)}
                              style={{ cursor: 'pointer' }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="13"
                                height="13"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span className="file-name-text">
                                {highlightText(
                                  (doc.fileName || 'file.pdf').length > 15
                                    ? (doc.fileName || 'file.pdf').substring(0, 14) + '...'
                                    : doc.fileName,
                                  searchQuery
                                )}
                              </span>
                            </span>

                            {/* View Action (👁️) */}
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="View Document"
                              onClick={() => handlePreview(doc, searchQuery, item.pageNum)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="15"
                                height="15"
                              >
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>

                          {/* Edit Action (✏️) - Only if user has edit access */}
                          {canEdit && (
                            <button
                              type="button"
                              className="icon-action-btn edit-btn"
                              title="Edit Document Details"
                              onClick={() => handleEditClick(doc)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="14"
                                height="14"
                              >
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                          )}

                          {/* Share Action (🔗) - Only if user has share access */}
                          {canShare && (
                            <button
                              type="button"
                              className="icon-action-btn share-btn"
                              title="Share Document Link"
                              onClick={() => handleShare(doc)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="14"
                                height="14"
                              >
                                <circle cx="18" cy="5" r="3" />
                                <circle cx="6" cy="12" r="3" />
                                <circle cx="18" cy="19" r="3" />
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                              </svg>
                            </button>
                          )}

                          {/* Download Action (📥) - Only if user has download access */}
                          {canDownload && (
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="Download Document"
                              onClick={() => handleDownload(doc)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="15"
                                height="15"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            </button>
                          )}

                          {/* Delete Action (🗑️) - Only if user has delete access */}
                          {canDelete && (
                            <button
                              type="button"
                              className="icon-action-btn delete-btn"
                              title="Delete Record"
                              onClick={() => handleDelete(doc.id, doc.s3Key)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                width="15"
                                height="15"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* ====================================================
          MODAL 1: Upload Document
          ==================================================== */}
      {showUploadModal && (
        <div className="modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Document</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowUploadModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="modal-form">
              <div className="form-row-2">
                <div className="modal-field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={newDoc.date}
                    onChange={(e) => setNewDoc({ ...newDoc, date: e.target.value })}
                    required
                  />
                </div>
                <div className="modal-field">
                  <label>Circular No</label>
                  <input
                    type="text"
                    placeholder="e.g. CIR/2026/FIN-105"
                    value={newDoc.circularNo}
                    onChange={(e) =>
                      setNewDoc({ ...newDoc, circularNo: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="modal-field">
                <label>Issuer / Department</label>
                <input
                  type="text"
                  placeholder="e.g. Ministry of Corporate Affairs"
                  value={newDoc.issuer}
                  onChange={(e) => setNewDoc({ ...newDoc, issuer: e.target.value })}
                  required
                />
              </div>

              <div className="modal-field">
                <label>
                  Subject{' '}
                  <span style={{ fontSize: '9pt', color: '#64748b', fontWeight: 'normal' }}>
                    (Optional for multiple files: defaults to filename if empty)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="Enter document subject or headline"
                  value={newDoc.subject}
                  onChange={(e) => setNewDoc({ ...newDoc, subject: e.target.value })}
                />
              </div>

              <div className="modal-field">
                <label>Remarks</label>
                <textarea
                  rows="2"
                  placeholder="Brief description or remarks"
                  value={newDoc.remarks}
                  onChange={(e) => setNewDoc({ ...newDoc, remarks: e.target.value })}
                />
              </div>

              <div className="modal-field">
                <label>
                  Attach Files (S3){' '}
                  <span style={{ fontSize: '9pt', color: '#2563eb', fontWeight: 'normal' }}>
                    • Select multiple files supported (PDF, Word, Excel, Images, Text)
                  </span>
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setSelectedFiles(files);
                  }}
                />

                {selectedFiles.length > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '9.5pt', color: '#15803d', fontWeight: 600 }}>
                        ✓ {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected:
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedFiles([])}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: '8.5pt',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Clear All
                      </button>
                    </div>
                    <ul
                      style={{
                        margin: '6px 0 0 0',
                        paddingLeft: '16px',
                        fontSize: '9pt',
                        color: '#475569',
                        maxHeight: '120px',
                        overflowY: 'auto',
                      }}
                    >
                      {selectedFiles.map((f, i) => (
                        <li key={i} style={{ marginBottom: '2px' }}>
                          <strong>{f.name}</strong> ({(f.size / 1024).toFixed(1)} KB)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowUploadModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit-upload"
                  disabled={isUploading}
                >
                  {isUploading
                    ? uploadProgress || 'Uploading to S3...'
                    : selectedFiles.length > 1
                    ? `Upload ${selectedFiles.length} Documents`
                    : 'Save Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 2: Edit Document
          ==================================================== */}
      {showEditModal && editingDoc && (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Document Details</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowEditModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="modal-form">
              <div className="form-row-2">
                <div className="modal-field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={editingDoc.date || ''}
                    onChange={(e) =>
                      setEditingDoc({ ...editingDoc, date: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="modal-field">
                  <label>Circular No</label>
                  <input
                    type="text"
                    value={editingDoc.circularNo || ''}
                    onChange={(e) =>
                      setEditingDoc({ ...editingDoc, circularNo: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="modal-field">
                <label>Issuer / Department</label>
                <input
                  type="text"
                  value={editingDoc.issuer || ''}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, issuer: e.target.value })
                  }
                  required
                />
              </div>

              <div className="modal-field">
                <label>Subject</label>
                <input
                  type="text"
                  value={editingDoc.subject || ''}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, subject: e.target.value })
                  }
                  required
                />
              </div>

              <div className="modal-field">
                <label>Remarks</label>
                <textarea
                  rows="2"
                  value={editingDoc.remarks || ''}
                  onChange={(e) =>
                    setEditingDoc({ ...editingDoc, remarks: e.target.value })
                  }
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-submit-upload">
                  Update Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 3: User Management (Super Admin & Admin)
          ==================================================== */}
      {showUserModal && (
        <div className="modal-backdrop" onClick={() => setShowUserModal(false)}>
          <div
            className="modal-card user-mgmt-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3>User & Access Management</h3>
                <p style={{ fontSize: '10.5pt', color: '#64748b', marginTop: '2px' }}>
                  Manage administrators, staff accounts, and granular permissions
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowUserModal(false)}
              >
                ✕
              </button>
            </div>

            {/* Toggle Add User Section */}
            <div className="user-modal-toolbar">
              <button
                type="button"
                className="btn-toggle-add-user"
                onClick={() => {
                  setShowAddUserForm(!showAddUserForm);
                  if (editingUser) setEditingUser(null);
                }}
              >
                {showAddUserForm ? '✕ Close Add Form' : '+ Add New User'}
              </button>
            </div>

            {/* Edit User Form (For Super Admin & Admin) */}
            {editingUser && (
              <form onSubmit={handleUpdateUserSubmit} className="add-user-form" style={{ borderColor: '#2563eb', backgroundColor: '#f8fafc', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ fontSize: '11.5pt', color: '#18181b', margin: 0 }}>
                    ✏️ Edit User: <strong style={{ color: '#2563eb' }}>{editingUser.username}</strong>
                    {editingUser.role === 'super_admin' && (
                      <span className="role-pill role-super" style={{ marginLeft: '8px' }}>
                        ★ Super Admin
                      </span>
                    )}
                  </h4>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '11pt' }}
                    onClick={() => setEditingUser(null)}
                  >
                    ✕ Close
                  </button>
                </div>

                <div className="form-row-2">
                  <div className="modal-field">
                    <label>Email Address</label>
                    <input
                      type="email"
                      placeholder="user@domain.com"
                      value={editingUser.email}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, email: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="modal-field">
                    <label>Role</label>
                    {editingUser.role === 'super_admin' ? (
                      <input
                        type="text"
                        value="Super Admin (Fixed Role)"
                        disabled
                        style={{ backgroundColor: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }}
                      />
                    ) : (
                      <select
                        value={editingUser.role}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, role: e.target.value })
                        }
                        style={{
                          padding: '9px 12px',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          backgroundColor: '#ffffff',
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="user">Standard User</option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
                    <label>New Password (leave empty to keep current password)</label>
                    <input
                      type="password"
                      placeholder="Enter new password (optional)"
                      value={editingUser.password}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, password: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Access Checklist */}
                <div className="modal-field" style={{ marginTop: '4px' }}>
                  <label style={{ marginBottom: '6px' }}>
                    Access Permissions (Checklist):
                    {editingUser.role === 'super_admin' && (
                      <span style={{ fontSize: '9.5pt', color: '#16a34a', marginLeft: '8px', fontWeight: 'normal' }}>
                        (All permissions granted by default for Super Admin)
                      </span>
                    )}
                  </label>
                  {editingUser.role === 'super_admin' ? (
                    <div className="permissions-checklist" style={{ backgroundColor: '#f8fafc', opacity: 0.95 }}>
                      {AVAILABLE_PERMISSIONS.map((perm) => (
                        <label
                          key={perm.id}
                          className="permission-checkbox-item"
                          style={{ cursor: 'default' }}
                          title="Super Admin has all permissions by default"
                        >
                          <input
                            type="checkbox"
                            checked={true}
                            disabled={true}
                          />
                          <span style={{ color: '#0f172a' }}>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="permissions-checklist">
                      {AVAILABLE_PERMISSIONS.map((perm) => (
                        <label key={perm.id} className="permission-checkbox-item">
                          <input
                            type="checkbox"
                            checked={editingUser.access.includes(perm.id)}
                            onChange={() => handleToggleEditPermission(perm.id)}
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="modal-actions" style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setEditingUser(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-submit-upload">
                    Save Changes
                  </button>
                </div>
              </form>
            )}

            {/* Add User Form */}
            {showAddUserForm && (
              <form onSubmit={handleCreateUserSubmit} className="add-user-form">
                <h4 style={{ fontSize: '11.5pt', marginBottom: '8px', color: '#18181b' }}>
                  Create New Account
                </h4>

                <div className="form-row-2">
                  <div className="modal-field">
                    <label>Email</label>
                    <input
                      type="email"
                      placeholder="user@domain.com"
                      value={newUser.email}
                      onChange={(e) =>
                        setNewUser({ ...newUser, email: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="modal-field">
                    <label>Username</label>
                    <input
                      type="text"
                      placeholder="Choose username"
                      value={newUser.username}
                      onChange={(e) =>
                        setNewUser({ ...newUser, username: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="modal-field">
                    <label>Password (Encrypted with bcrypt)</label>
                    <input
                      type="password"
                      placeholder="Enter initial password"
                      value={newUser.password}
                      onChange={(e) =>
                        setNewUser({ ...newUser, password: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="modal-field">
                    <label>Role</label>
                    <select
                      value={newUser.role}
                      onChange={(e) =>
                        setNewUser({ ...newUser, role: e.target.value })
                      }
                      style={{
                        padding: '9px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="user">Standard User</option>
                    </select>
                  </div>
                </div>

                {/* Access Checklist */}
                <div className="modal-field" style={{ marginTop: '4px' }}>
                  <label style={{ marginBottom: '6px' }}>Access Permissions (Checklist):</label>
                  <div className="permissions-checklist">
                    {AVAILABLE_PERMISSIONS.map((perm) => (
                      <label key={perm.id} className="permission-checkbox-item">
                        <input
                          type="checkbox"
                          checked={newUser.access.includes(perm.id)}
                          onChange={() => handleTogglePermission(perm.id)}
                        />
                        <span>{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-actions" style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setShowAddUserForm(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-submit-upload">
                    Save User to DynamoDB
                  </button>
                </div>
              </form>
            )}

            {/* Existing Users Table */}
            <div className="existing-users-section">
              <h4 style={{ fontSize: '11.5pt', margin: '14px 0 8px 0', color: '#18181b' }}>
                Existing Users in `koogle_users` ({userList.length})
              </h4>

              {userLoading ? (
                <p style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                  Loading users...
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="user-mgmt-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Permissions</th>
                        <th style={{ width: '120px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userList.map((u) => (
                        <tr key={u.username}>
                          <td style={{ fontWeight: 'normal' }}>{u.username}</td>
                          <td style={{ color: '#64748b' }}>{u.email || '-'}</td>
                          <td>
                            <span
                              className={`role-pill ${
                                u.role === 'super_admin' ? 'role-super' : 'role-admin'
                              }`}
                            >
                              {u.role === 'super_admin' ? '★ Super Admin' : u.role}
                            </span>
                          </td>
                          <td>
                            <div className="perm-pills-row">
                              {(u.access || []).map((p) => (
                                <span key={p} className="access-tag">
                                  {p}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end' }}>
                              {/* Edit Button for ALL users including superadmin */}
                              <button
                                type="button"
                                className="icon-action-btn edit-btn"
                                title={`Edit ${u.username}`}
                                onClick={() => handleStartEditUser(u)}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  width="14"
                                  height="14"
                                >
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                              </button>

                              {/* Delete Button (Protected for super_admin) */}
                              {u.role === 'super_admin' ? (
                                <span style={{ fontSize: '9pt', color: '#94a3b8', fontStyle: 'italic', paddingLeft: '2px' }}>
                                  Protected
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="icon-action-btn delete-btn"
                                  title="Delete User"
                                  onClick={() => handleDeleteUser(u.username)}
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    width="14"
                                    height="14"
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ====================================================
          MODAL 4: In-App Document Preview Modal
          ==================================================== */}
      {previewModal && (
        <div className="modal-backdrop preview-backdrop" onClick={() => setPreviewModal(null)}>
          <div
            className={`modal-card doc-preview-modal-card ${isFullscreen ? 'is-fullscreen' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="doc-preview-header">
              <div>
                <h3 style={{ fontSize: '13pt', color: '#0f172a', margin: 0 }}>
                  📄 {previewModal.doc.subject}
                </h3>
                <p style={{ fontSize: '10pt', color: '#64748b', marginTop: '4px', margin: 0 }}>
                  File: <strong>{previewModal.doc.fileName}</strong> • Circular: {previewModal.doc.circularNo} • Issuer: {previewModal.doc.issuer}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Search input in header (when in native mode) */}
                {previewModal.fileType === 'pdf' && pdfViewerMode === 'native' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
                    <div className="pdf-search-box">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search keyword in PDF..."
                        value={pdfKeyword}
                        onChange={(e) => setPdfKeyword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSearchPdf();
                        }}
                      />
                      <button
                        type="button"
                        className="btn-pdf-search"
                        onClick={handleSearchPdf}
                        disabled={pdfSearching}
                        title="Search keyword in all PDF pages"
                      >
                        {pdfSearching ? '...' : 'Find'}
                      </button>
                      {pdfKeyword && (
                        <button
                          type="button"
                          className="btn-pdf-clear"
                          onClick={handleClearPdfSearch}
                          title="Clear Search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Navigation between matches */}
                    {pdfSearchResults.length > 0 && (
                      <div className="pdf-match-nav">
                        <span className="pdf-match-count">
                          {currentMatchIdx + 1} of {pdfSearchResults.length} (Pg {pdfSearchResults[currentMatchIdx]?.pageNum || 1})
                        </span>
                        <button
                          type="button"
                          className="btn-match-nav"
                          onClick={handlePrevMatch}
                          title="Previous match"
                        >
                          ❮
                        </button>
                        <button
                          type="button"
                          className="btn-match-nav"
                          onClick={handleNextMatch}
                          title="Next match"
                        >
                          ❯
                        </button>
                      </div>
                    )}

                    {pdfSearchMessage && !pdfSearchResults.length && (
                      <span style={{ fontSize: '9.5pt', color: '#dc2626', whiteSpace: 'nowrap' }}>
                        {pdfSearchMessage}
                      </span>
                    )}
                  </div>
                )}

                {/* PDF Viewer Mode Switcher */}
                {previewModal.fileType === 'pdf' && (
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{
                      padding: '7px 12px',
                      fontSize: '10pt',
                      backgroundColor: pdfViewerMode === 'highlight' ? '#fef3c7' : '#ffffff',
                      borderColor: pdfViewerMode === 'highlight' ? '#f59e0b' : '#cbd5e1',
                      color: pdfViewerMode === 'highlight' ? '#b45309' : '#0f172a',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '500',
                    }}
                    onClick={() => setPdfViewerMode(pdfViewerMode === 'highlight' ? 'native' : 'highlight')}
                    title="Toggle between Yellow Highlighter View and Browser Native PDF Viewer"
                  >
                    {pdfViewerMode === 'highlight' ? '🎨 Highlight Mode' : '📄 Native Mode'}
                  </button>
                )}

                {previewModal.fileType === 'office' && (
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{
                      padding: '7px 12px',
                      fontSize: '10pt',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      setPreviewModal((prev) => ({
                        ...prev,
                        viewerEngine: prev.viewerEngine === 'google' ? 'office' : 'google',
                      }))
                    }
                    title="Switch viewer between Google Docs Viewer & Microsoft Office Online"
                  >
                    {previewModal.viewerEngine === 'google' ? '⇄ Try Office Viewer' : '⇄ Try Google Viewer'}
                  </button>
                )}

                {/* Fullscreen Toggle */}
                <button
                  type="button"
                  className="btn-cancel"
                  style={{
                    padding: '7px 14px',
                    fontSize: '10.5pt',
                    backgroundColor: isFullscreen ? '#0f172a' : '#ffffff',
                    color: isFullscreen ? '#ffffff' : '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                >
                  {isFullscreen ? '⤓ Normal View' : '⛶ Fullscreen'}
                </button>

                <button
                  type="button"
                  className="btn-cancel"
                  style={{
                    padding: '7px 14px',
                    fontSize: '10.5pt',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                  onClick={() => window.open(previewModal.url, '_blank')}
                  title="Open document in a new tab"
                >
                  Open in New Tab ↗
                </button>

                {canDownload && (
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{
                      padding: '7px 14px',
                      fontSize: '10.5pt',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleDownload(previewModal.doc)}
                    title="Download document file"
                  >
                    Download ⬇
                  </button>
                )}

                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setPreviewModal(null)}
                  title="Close Preview"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="doc-preview-body">
              {/* Loading State */}
              {previewLoading && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px auto', borderTopColor: '#18181b' }} />
                  <p style={{ fontSize: '11pt', margin: 0 }}>Rendering document preview...</p>
                </div>
              )}

              {/* Error State */}
              {!previewLoading && previewError && (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p style={{ color: '#ef4444', fontSize: '11.5pt', marginBottom: '12px' }}>{previewError}</p>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ padding: '8px 16px', fontSize: '10.5pt', cursor: 'pointer' }}
                    onClick={() => handleDownload(previewModal.doc)}
                  >
                    Download File Instead ⬇
                  </button>
                </div>
              )}

              {/* Excel Spreadsheet Preview (.xlsx, .xls) */}
              {!previewLoading && !previewError && previewModal.fileType === 'excel' && (
                <div className="excel-preview-container">
                  {excelSheets.length > 1 && (
                    <div className="excel-sheets-bar">
                      {excelSheets.map((sheet, idx) => (
                        <button
                          key={sheet.name}
                          type="button"
                          className={`excel-sheet-tab ${activeSheetIndex === idx ? 'active-tab' : ''}`}
                          onClick={() => setActiveSheetIndex(idx)}
                        >
                          📊 {sheet.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    className="excel-table-scroll"
                    dangerouslySetInnerHTML={{
                      __html: excelSheets[activeSheetIndex]?.html || '<p style="padding: 20px; color: #64748b;">No data found in sheet.</p>',
                    }}
                  />
                </div>
              )}

              {/* Word Document Preview (.docx, .doc) */}
              {!previewLoading && !previewError && previewModal.fileType === 'word' && (
                wordHtml ? (
                  <div
                    className="word-preview-container"
                    dangerouslySetInnerHTML={{ __html: wordHtml }}
                  />
                ) : (
                  <iframe
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewModal.url)}&embedded=true`}
                    title="Word Document Preview"
                    className="doc-preview-iframe"
                  />
                )
              )}

              {/* Image Preview */}
              {!previewLoading && !previewError && previewModal.fileType === 'image' && (
                <img
                  src={previewModal.url}
                  alt={previewModal.doc.subject}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    padding: '10px',
                  }}
                />
              )}

              {/* PDF Preview */}
              {!previewLoading && !previewError && previewModal.fileType === 'pdf' && (
                pdfViewerMode === 'highlight' ? (
                  <PdfHighlightViewer
                    url={previewModal.url}
                    initialKeyword={pdfKeyword}
                  />
                ) : (
                  <iframe
                    key={pdfSearchUrl || 'default-pdf'}
                    src={
                      pdfSearchUrl ||
                      (previewModal.url.includes('#')
                        ? previewModal.url
                        : `${previewModal.url}#toolbar=1&navpanes=0&view=FitH`)
                    }
                    title={previewModal.doc.subject}
                    className="doc-preview-iframe"
                  />
                )
              )}

              {/* Text File Preview (.txt, .csv, .log, .json) */}
              {!previewLoading && !previewError && previewModal.fileType === 'text' && (
                <div style={{ width: '100%', height: '100%', padding: '16px', overflow: 'auto', backgroundColor: '#f8fafc' }}>
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: '11pt',
                      lineHeight: '1.6',
                      color: '#0f172a',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {textContent}
                  </pre>
                </div>
              )}

              {/* PowerPoint & Office Preview (.ppt, .pptx) */}
              {!previewLoading && !previewError && previewModal.fileType === 'office' && (
                <iframe
                  src={
                    previewModal.viewerEngine === 'office'
                      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewModal.url)}`
                      : `https://docs.google.com/viewer?url=${encodeURIComponent(previewModal.url)}&embedded=true`
                  }
                  title="Office Document Viewer"
                  className="doc-preview-iframe"
                />
              )}

              {/* Fallback for other formats */}
              {!previewLoading && !previewError && previewModal.fileType === 'other' && (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p style={{ fontSize: '13pt', color: '#1e293b', marginBottom: '8px' }}>
                    Preview not directly supported for <strong>{previewModal.doc.fileName}</strong>
                  </p>
                  <p style={{ fontSize: '11pt', color: '#64748b', marginBottom: '20px' }}>
                    Click below to open or download the file.
                  </p>
                  <button
                    type="button"
                    className="btn-submit-upload"
                    style={{ padding: '10px 20px', cursor: 'pointer' }}
                    onClick={() => handleDownload(previewModal.doc)}
                  >
                    Download File ({previewModal.doc.fileName})
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
