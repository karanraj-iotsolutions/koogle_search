import React, { useState } from 'react';
import './login_page.css';
import { loginUser, sendOtp, verifyOtp, resetPassword } from '../services/api';

export default function LoginPage({ onLoginSuccess }) {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Forgot Password Modal State
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name] || errors.general) {
      setErrors((prev) => ({ ...prev, [name]: '', general: '' }));
    }
  };

  const validate = () => {
    const errs = {};
    if (!formData.username.trim()) {
      errs.username = 'Username is required';
    }
    if (!formData.password) {
      errs.password = 'Password is required';
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const res = await loginUser(formData.username.trim(), formData.password);
      if (res.message) {
        alert(res.message);
      }
      if (onLoginSuccess) {
        onLoginSuccess(res.user, res.role, res.access);
      }
    } catch (err) {
      setErrors({ general: err.message || 'Login failed' });
    } finally {
      setIsLoading(false);
    }
  };

  // Open Forgot Modal
  const handleOpenForgot = (e) => {
    e.preventDefault();
    setShowForgotModal(true);
    setForgotStep(1);
    setForgotEmail(formData.username ? formData.username.trim() : '');
    setForgotOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setForgotError('');
    setForgotSuccess('');
  };

  // Close Forgot Modal
  const handleCloseForgot = () => {
    setShowForgotModal(false);
    setForgotStep(1);
    setForgotError('');
    setForgotSuccess('');
  };

  // Step 1: Send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setForgotError('Please enter your email or username');
      return;
    }
    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess('');

    try {
      const res = await sendOtp(forgotEmail.trim());
      setForgotSuccess(res.message || 'OTP sent successfully to your email.');
      setForgotStep(2);
    } catch (err) {
      setForgotError(err.message || 'Failed to send OTP. Please check your email.');
    } finally {
      setForgotLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!forgotOtp.trim()) {
      setForgotError('Please enter the 6-digit OTP code');
      return;
    }
    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess('');

    try {
      const res = await verifyOtp(forgotEmail.trim(), forgotOtp.trim());
      setForgotSuccess(res.message || 'OTP verified successfully!');
      setForgotStep(3);
    } catch (err) {
      setForgotError(err.message || 'Invalid or expired OTP. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // Step 3: Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!newPassword) {
      setForgotError('Please enter a new password');
      return;
    }
    if (newPassword.length < 6) {
      setForgotError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Passwords do not match');
      return;
    }

    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess('');

    try {
      const res = await resetPassword(forgotEmail.trim(), forgotOtp.trim(), newPassword);
      alert(res.message || 'Password reset successfully! Please log in with your new password.');
      setShowForgotModal(false);
      setFormData((prev) => ({
        ...prev,
        password: '',
      }));
    } catch (err) {
      setForgotError(err.message || 'Failed to reset password');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        {/* Document Icon in Black Box */}
        <div className="header-icon-box">
          <svg
            className="doc-icon"
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

        {/* Title & Subtitle */}
        <h1 className="login-title">Sign in to your account</h1>
        <p className="login-subtitle">Enter your details to access the dashboard</p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form" noValidate>
          {/* Username Field */}
          <div className="input-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="leading-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                id="username"
                name="username"
                type="text"
                placeholder="Enter username"
                value={formData.username}
                onChange={handleChange}
                className={errors.username ? 'input-error' : ''}
                autoComplete="username"
              />
            </div>
            {errors.username && (
              <span className="error-text">{errors.username}</span>
            )}
          </div>

          {/* Password Field */}
          <div className="input-group">
            <div className="label-row">
              <label htmlFor="password">Password</label>
              <button
                type="button"
                onClick={handleOpenForgot}
                className="forgot-pass-link-btn"
              >
                Forgot pass?
              </button>
            </div>
            <div className="input-wrapper">
              <span className="leading-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={formData.password}
                onChange={handleChange}
                className={errors.password ? 'input-error' : ''}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="eye-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
                aria-label="Toggle password visibility"
              >
                {showPassword ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {errors.password && (
              <span className="error-text">{errors.password}</span>
            )}
          </div>

          {errors.general && (
            <div
              className="error-text"
              style={{ textAlign: 'center', margin: '4px 0' }}
            >
              {errors.general}
            </div>
          )}

          {/* Login Button */}
          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? <div className="spinner"></div> : 'Login'}
          </button>
        </form>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="forgot-modal-backdrop" onClick={handleCloseForgot}>
          <div
            className="forgot-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="forgot-modal-header">
              <div className="forgot-header-titles">
                <h2 className="forgot-title">Reset Password</h2>
                <p className="forgot-subtitle">
                  {forgotStep === 1 && 'Enter your email to receive a 6-digit OTP code.'}
                  {forgotStep === 2 && 'Enter the 6-digit OTP sent to your email.'}
                  {forgotStep === 3 && 'Create and confirm your new password.'}
                </p>
              </div>
              <button
                type="button"
                className="forgot-close-btn"
                onClick={handleCloseForgot}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Stepper Progress */}
            <div className="forgot-stepper">
              <div className={`step-item ${forgotStep >= 1 ? 'step-active' : ''}`}>
                <span className="step-number">1</span>
                <span className="step-label">Email</span>
              </div>
              <div className="step-divider" />
              <div className={`step-item ${forgotStep >= 2 ? 'step-active' : ''}`}>
                <span className="step-number">2</span>
                <span className="step-label">OTP Code</span>
              </div>
              <div className="step-divider" />
              <div className={`step-item ${forgotStep >= 3 ? 'step-active' : ''}`}>
                <span className="step-number">3</span>
                <span className="step-label">New Password</span>
              </div>
            </div>

            {/* Status Messages */}
            {forgotError && <div className="forgot-error-banner">{forgotError}</div>}
            {forgotSuccess && <div className="forgot-success-banner">{forgotSuccess}</div>}

            {/* Step 1: Request OTP by Email */}
            {forgotStep === 1 && (
              <form onSubmit={handleSendOtp} className="forgot-step-form">
                <div className="input-group">
                  <label htmlFor="forgotEmail">Email or Username</label>
                  <div className="input-wrapper">
                    <span className="leading-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </span>
                    <input
                      id="forgotEmail"
                      type="text"
                      placeholder="e.g. support.kooglesearch@gmail.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="modal-primary-btn"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? <div className="spinner"></div> : 'Send OTP'}
                </button>
              </form>
            )}

            {/* Step 2: Enter & Verify OTP */}
            {forgotStep === 2 && (
              <form onSubmit={handleVerifyOtp} className="forgot-step-form">
                <div className="input-group">
                  <label htmlFor="forgotOtp">6-Digit OTP Code</label>
                  <input
                    id="forgotOtp"
                    type="text"
                    maxLength="6"
                    placeholder="Enter 6-digit OTP"
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                    className="otp-code-input"
                    autoFocus
                  />
                  <div className="otp-resend-row">
                    <span className="otp-hint-text">Check your inbox or spam folder</span>
                    <button
                      type="button"
                      className="resend-otp-btn"
                      onClick={handleSendOtp}
                      disabled={forgotLoading}
                    >
                      Resend OTP
                    </button>
                  </div>
                </div>

                <div className="modal-buttons-row">
                  <button
                    type="button"
                    className="modal-secondary-btn"
                    onClick={() => {
                      setForgotStep(1);
                      setForgotError('');
                      setForgotSuccess('');
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="modal-primary-btn"
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? <div className="spinner"></div> : 'Verify OTP'}
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: Enter New Password & Confirm */}
            {forgotStep === 3 && (
              <form onSubmit={handleResetPassword} className="forgot-step-form">
                {/* New Password */}
                <div className="input-group">
                  <label htmlFor="newPassword">New Password</label>
                  <div className="input-wrapper">
                    <span className="leading-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Minimum 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="eye-toggle-btn"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      tabIndex="-1"
                    >
                      {showNewPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="input-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <div className="input-wrapper">
                    <span className="leading-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="eye-toggle-btn"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      tabIndex="-1"
                    >
                      {showConfirmPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="modal-buttons-row">
                  <button
                    type="button"
                    className="modal-secondary-btn"
                    onClick={() => {
                      setForgotStep(2);
                      setForgotError('');
                      setForgotSuccess('');
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="modal-primary-btn"
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? <div className="spinner"></div> : 'Update Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
