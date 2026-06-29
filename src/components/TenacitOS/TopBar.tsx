"use client";

import { useState, useEffect, useRef } from "react";
import { Search, User, Key, ImageIcon, LogOut, ChevronDown } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { BRANDING } from "@/config/branding";

export function TopBar() {
  const [showSearch, setShowSearch] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Load avatar
  useEffect(() => {
    fetch("/api/auth/avatar")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.url) setAvatarUrl(d.url); })
      .catch(() => {});
  }, []);

  // Close profile menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/auth/avatar", { method: "POST", body: fd });
      if (res.ok) {
        const d = await res.json();
        setAvatarUrl(d.url + "?t=" + Date.now());
        setShowAvatarModal(false);
      }
    } catch {}
    setAvatarUploading(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      // Escape to close search
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  return (
    <>
      <div
        className="top-bar"
        style={{
          position: "fixed",
          top: 0,
          left: "68px", // Width of dock
          right: 0,
          height: "48px",
          backgroundColor: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          zIndex: 45,
        }}
      >
        {/* Left: Logo & Title */}
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "20px" }}>🦞</span>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.5px",
            }}
          >
            TenacitOS
          </h1>
          {/* Version Badge */}
          <div
            style={{
              backgroundColor: "var(--accent-soft)",
              borderRadius: "4px",
              padding: "2px 8px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "9px",
                fontWeight: 700,
                color: "var(--accent)",
                letterSpacing: "1px",
              }}
            >
              v1.0
            </span>
          </div>
        </div>

        {/* Right: Search + Notifications + User */}
        <div className="flex items-center gap-3">
          {/* Search Box */}
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 transition-all"
            style={{
              width: "240px",
              height: "32px",
              backgroundColor: "var(--surface-elevated)",
              borderRadius: "6px",
              padding: "0 12px",
            }}
          >
            <Search
              className="flex-shrink-0"
              style={{
                width: "16px",
                height: "16px",
                color: "var(--text-muted)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              Search... ⌘K
            </span>
          </button>

          {/* Notifications Dropdown */}
          <NotificationDropdown />

          {/* User Area */}
          <div ref={profileMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setShowProfileMenu(v => !v)}
              className="flex items-center gap-2"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "6px" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--surface-elevated)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {/* Avatar */}
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "14px",
                  backgroundColor: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
                    {BRANDING.ownerUsername.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              {/* Name */}
              <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)" }}>
                {BRANDING.ownerUsername}
              </span>
              <ChevronDown style={{ width: "12px", height: "12px", color: "var(--text-muted)" }} />
            </button>

            {/* Profile Dropdown */}
            {showProfileMenu && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0,
                minWidth: "180px", backgroundColor: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 100, overflow: "hidden",
              }}>
                <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{BRANDING.ownerUsername}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Administrator</div>
                </div>
                {[
                  { icon: ImageIcon, label: "Change Profile Picture", action: () => { setShowAvatarModal(true); setShowProfileMenu(false); } },
                  { icon: Key, label: "Change Password", action: () => { setShowPasswordModal(true); setShowProfileMenu(false); } },
                ].map(({ icon: Icon, label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="flex items-center gap-2 w-full text-left"
                    style={{
                      padding: "9px 14px", background: "none", border: "none", cursor: "pointer",
                      fontSize: "13px", color: "var(--text-secondary)", transition: "all 120ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--surface-elevated)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                  >
                    <Icon style={{ width: "14px", height: "14px" }} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => setShowPasswordModal(false)}
      />

      {/* Avatar Upload Modal */}
      {showAvatarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setShowAvatarModal(false)}>
          <div style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", maxWidth: "360px", width: "100%", margin: "0 16px" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>Change Profile Picture</h2>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>Upload a PNG, JPG, or WebP image (max 2MB).</p>
            <label style={{ display: "block", padding: "32px", border: "2px dashed var(--border)", borderRadius: "8px", textAlign: "center", cursor: "pointer", color: "var(--text-muted)", fontSize: "13px" }}>
              {avatarUploading ? "Uploading..." : "Click or drag to upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                disabled={avatarUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }}
              />
            </label>
            <button onClick={() => setShowAvatarModal(false)} style={{ marginTop: "16px", width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Global Search Modal */}
      {showSearch && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.8)",
          }}
          onClick={() => setShowSearch(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "90%",
              maxWidth: "42rem",
            }}
          >
            <GlobalSearch />
          </div>
        </div>
      )}
    </>
  );
}
