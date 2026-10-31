const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.machkg.com/koogle/api';

/**
 * Fetch all documents from DynamoDB
 */
export async function getDocuments() {
  const res = await fetch(`${API_BASE}/documents`);
  if (!res.ok) {
    throw new Error(`Failed to fetch documents: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Upload document file to S3 and save metadata in DynamoDB
 */
export async function uploadDocument(formData) {
  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData, // FormData contains fields and file
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || 'Failed to upload document');
  }
  return res.json();
}

/**
 * Get S3 pre-signed secure URL for preview or download
 */
export async function getDocumentUrl(s3Key, action = 'view') {
  const res = await fetch(
    `${API_BASE}/documents/url?s3Key=${encodeURIComponent(s3Key)}&action=${action}`
  );
  if (!res.ok) {
    throw new Error('Failed to obtain download URL');
  }
  const data = await res.json();
  return data.url;
}

/**
 * Delete document from DynamoDB and S3
 */
export async function deleteDocument(id, s3Key) {
  const url = s3Key
    ? `${API_BASE}/documents/${id}?s3Key=${encodeURIComponent(s3Key)}`
    : `${API_BASE}/documents/${id}`;

  const res = await fetch(url, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to delete document');
  }
  return res.json();
}

/**
 * Update document metadata (edit)
 */
export async function updateDocument(id, docData) {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(docData),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || 'Failed to update document');
  }
  return res.json();
}

/**
 * Fetch all users (Super Admin / Admin)
 */
export async function getUsers() {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) {
    throw new Error('Failed to fetch users');
  }
  return res.json();
}

/**
 * Create new user with access permissions
 */
export async function createUser(userData) {
  const res = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Failed to create user');
  }
  return data;
}

/**
 * Update user details (email, role, password, access)
 */
export async function updateUser(username, userData) {
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Failed to update user');
  }
  return data;
}

/**
 * Delete a user
 */
export async function deleteUser(username) {
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete user');
  }
  return data;
}

/**
 * Login authentication against DynamoDB `koogle_users`
 */
export async function loginUser(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Login failed');
  }
  return data;
}

/**
 * Send Password Reset OTP to Email
 */
export async function sendOtp(email) {
  const res = await fetch(`${API_BASE}/forgot-password/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Failed to send OTP');
  }
  return data;
}

/**
 * Verify Password Reset OTP
 */
export async function verifyOtp(email, otp) {
  const res = await fetch(`${API_BASE}/forgot-password/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Failed to verify OTP');
  }
  return data;
}

/**
 * Reset Password with OTP & new password
 */
export async function resetPassword(email, otp, newPassword) {
  const res = await fetch(`${API_BASE}/forgot-password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || 'Failed to reset password');
  }
  return data;
}

