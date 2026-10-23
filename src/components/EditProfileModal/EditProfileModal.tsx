"use client";

import React, { useState, useEffect } from "react";
import styles from "../SharedModal.module.css";
import localStyles from "../../app/[locale]/users/[username]/page.module.css";
import { showToast } from "@/components/Toast/ToastListener";
import AccessibleDialog from "@/components/AccessibleDialog/AccessibleDialog";
import Button from "@/components/Button/Button";
import ImageCropper from "./ImageCropper";
import { useTranslations } from "next-intl";

interface FavoriteAlbumRelation {
  slot: number;
  musicItem: {
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    type: string;
  };
}

interface UserProfile {
  username: string;
  bio: string | null;
  favoriteGenre: string | null;
  profileColor: string | null;
  profileImage: string | null;
  createdAt: string;
  favoriteAlbums?: FavoriteAlbumRelation[];
}

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onSave: () => Promise<void>;
}

const COLOR_MAP: Record<string, { value: string }> = {
  emerald: { value: "#10b981" },
  violet: { value: "#8b5cf6" },
  cobalt: { value: "#3b82f6" },
  amber: { value: "#f59e0b" },
  rose: { value: "#f43f5e" },
  slate: { value: "#64748b" }
};

export default function EditProfileModal({ isOpen, onClose, profile, onSave }: EditProfileModalProps) {
  const t = useTranslations("Profile");
  const common = useTranslations("Common");
  const [editBio, setEditBio] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editColor, setEditColor] = useState("emerald");
  const [editImage, setEditImage] = useState("");
  const [saving, setSaving] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen && profile) {
      setEditBio(profile.bio || "");
      setEditGenre(profile.favoriteGenre || "");
      setEditColor(profile.profileColor || "emerald");
      setEditImage(profile.profileImage || "");
      setCropImageSrc(null);
    }
  }, [isOpen, profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 007-security-auditor & Optimizer: File size check (2MB)
    if (file.size > 2 * 1024 * 1024) {
      showToast(t("imageTooLarge"), "error");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        setCropImageSrc(reader.result);
        e.target.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${profile.username}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: editBio,
          favoriteGenre: editGenre,
          profileColor: editColor,
          profileImage: editImage
        })
      });

      if (!res.ok) {
        showToast(t("profileUpdateError"), "error");
        return;
      }

      showToast(t("profileUpdated"), "success");
      await onSave();
      onClose();
    } catch (e) {
      console.error("Save profile error:", e);
      showToast(common("connectionError"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AccessibleDialog isOpen={isOpen} onClose={onClose} labelledBy="edit-profile-dialog-title" className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3 id="edit-profile-dialog-title" className={styles.modalTitle}>
            {cropImageSrc ? t("cropPhoto") : t("editProfile")}
          </h3>
          <button type="button" data-dialog-initial-focus onClick={onClose} className={styles.closeBtn} aria-label={common("close")}>
            &times;
          </button>
        </div>

        {cropImageSrc ? (
          <ImageCropper
            imageSrc={cropImageSrc}
            profileColor={editColor}
            onCancel={() => setCropImageSrc(null)}
            onCropComplete={(croppedImage) => {
              setEditImage(croppedImage);
              setCropImageSrc(null);
            }}
          />
        ) : (
          <form onSubmit={handleSubmit} className={styles.formContainer}>
            {/* Foto de Perfil Picker */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("profilePhoto")}</label>
              <div style={{ display: "flex", gap: "14px", marginBottom: "12px", alignItems: "center", flexWrap: "wrap" }}>
                {/* Default Text Initials Fallback */}
                <div 
                  onClick={() => setEditImage("")}
                  style={{
                    width: "50px",
                    height: "50px",
                    borderRadius: "50%",
                    backgroundColor: `${COLOR_MAP[editColor]?.value || "#10b981"}1a`,
                    color: COLOR_MAP[editColor]?.value || "#10b981",
                    border: `2px solid ${editImage === "" ? (COLOR_MAP[editColor]?.value || "#10b981") : `${COLOR_MAP[editColor]?.value || "#10b981"}33`}`,
                    boxShadow: editImage === "" ? `0 0 10px ${COLOR_MAP[editColor]?.value || "#10b981"}55` : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  title={t("profileInitials")}
                >
                  {profile.username.substring(0, 2).toUpperCase()}
                </div>

                {/* Music Theme Presets */}
                {[1, 2, 3].map((num) => {
                  const presetUrl = `/avatars/preset-${num}.png`;
                  const isActive = editImage === presetUrl;
                  const activeColor = COLOR_MAP[editColor]?.value || "#10b981";
                  return (
                    <img
                      key={num}
                      src={presetUrl}
                      alt={t("avatarPreset", { number: num })}
                      onClick={() => setEditImage(presetUrl)}
                      style={{
                        width: "50px",
                        height: "50px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        cursor: "pointer",
                        border: `2px solid ${isActive ? activeColor : "transparent"}`,
                        boxShadow: isActive ? `0 0 10px ${activeColor}55` : "none",
                        transition: "all 0.2s"
                      }}
                    />
                  );
                })}

                {/* Custom uploaded image preview */}
                {(editImage.startsWith("data:image/") || editImage.startsWith("/uploads/") || editImage.startsWith("/api/users/")) && (
                  <div style={{ position: "relative" }}>
                    <img
                      src={editImage}
                      alt={t("uploadedProfilePhoto")}
                      onClick={() => setEditImage(editImage)}
                      style={{
                        width: "50px",
                        height: "50px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: `2px solid ${COLOR_MAP[editColor]?.value || "#10b981"}`,
                        boxShadow: `0 0 10px ${COLOR_MAP[editColor]?.value || "#10b981"}55`,
                        cursor: "pointer"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setEditImage("")}
                      style={{
                        position: "absolute",
                        top: "-4px",
                        right: "-4px",
                        background: "#f43f5e",
                        color: "#fff",
                        border: "none",
                        borderRadius: "50%",
                        width: "18px",
                        height: "18px",
                        fontSize: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        fontWeight: "bold"
                      }}
                      title={t("removeUploadedPhoto")}
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>

              {/* Custom File Uploader Button */}
              <div style={{ marginTop: "8px" }}>
                <label 
                  style={{ 
                    display: "inline-flex", 
                    alignItems: "center", 
                    gap: "8px", 
                    padding: "8px 16px", 
                    borderRadius: "8px", 
                    background: "rgba(255, 255, 255, 0.05)", 
                    border: "1px dashed var(--border)", 
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    transition: "all 0.2s"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = COLOR_MAP[editColor]?.value || "#10b981";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  {t("uploadImage")}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
            </div>

            {/* Bio */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("biography")}</label>
              <textarea
                className={styles.formInput}
                rows={4}
                maxLength={500}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder={t("bioPlaceholder")}
                style={{ resize: "none" }}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textAlign: "right" }}>
                {t("characterCount", { count: editBio.length, max: 500 })}
              </span>
            </div>

            {/* Genre */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("favoriteGenre")}</label>
              <input
                type="text"
                className={styles.formInput}
                value={editGenre}
                maxLength={50}
                onChange={(e) => setEditGenre(e.target.value)}
                placeholder={t("genrePlaceholder")}
              />
            </div>

            {/* Color Preset Selector */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("profileColor")}</label>
              <div className={localStyles.colorPicker}>
                {Object.keys(COLOR_MAP).map((colorKey) => {
                  const colorData = COLOR_MAP[colorKey];
                  return (
                    <div
                      key={colorKey}
                      className={`${localStyles.colorOption} ${
                        editColor === colorKey ? localStyles.colorOptionActive : ""
                      }`}
                      style={{ backgroundColor: colorData.value }}
                      onClick={() => setEditColor(colorKey)}
                      title={colorKey}
                    />
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className={styles.modalFooter}>
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                {common("cancel")}
              </Button>
              <Button type="submit" isLoading={saving} loadingLabel={t("changingPassword")}>
                {common("saveChanges")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AccessibleDialog>
  );
}
