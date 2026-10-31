import React, { useState } from 'react';
import LoginPage from './components/login_page';
import DashboardPage from './components/dashboard_page';

const AUTH_STORAGE_KEY = 'koogle_auth_session';

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.user || null;
      }
    } catch (e) {
      console.warn('Failed to parse auth session from localStorage:', e);
    }
    return null;
  });

  const [currentRole, setCurrentRole] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.role || 'user';
      }
    } catch (e) {
      console.warn('Failed to parse auth role from localStorage:', e);
    }
    return null;
  });

  const [currentAccess, setCurrentAccess] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed.role === 'super_admin' ||
          !Array.isArray(parsed.access) ||
          parsed.access.length === 0
        ) {
          return ['upload', 'edit', 'delete', 'download', 'share'];
        }
        return parsed.access;
      }
    } catch (e) {
      console.warn('Failed to parse auth access from localStorage:', e);
    }
    return ['upload', 'edit', 'delete', 'download', 'share'];
  });

  const handleLoginSuccess = (username, role, access) => {
    const user = username || 'admin';
    const userRole = role || 'user';
    const userAccess =
      userRole === 'super_admin' || !Array.isArray(access) || access.length === 0
        ? ['upload', 'edit', 'delete', 'download', 'share']
        : access;

    setCurrentUser(user);
    setCurrentRole(userRole);
    setCurrentAccess(userAccess);

    try {
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          user,
          role: userRole,
          access: userAccess,
          loggedInAt: new Date().toISOString(),
        })
      );
    } catch (e) {
      console.warn('Failed to save auth session to localStorage:', e);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentRole(null);
    setCurrentAccess([]);
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to remove auth session from localStorage:', e);
    }
  };

  if (currentUser) {
    return (
      <DashboardPage
        user={currentUser}
        role={currentRole}
        access={currentAccess}
        onLogout={handleLogout}
      />
    );
  }

  return <LoginPage onLoginSuccess={handleLoginSuccess} />;
}
