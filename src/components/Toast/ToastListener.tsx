"use client";

import React, { useState, useEffect } from "react";
import styles from "./Toast.module.css";

interface ToastMessage {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

export function showToast(message: string, type: "success" | "error" | "info" = "success") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("rtm-toast", {
        detail: { message, type },
      })
    );
  }
}

export default function ToastListener() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; type: "success" | "error" | "info" }>;
      const { message, type } = customEvent.detail;
      const id = Math.random().toString(36).substring(2, 9);
      
      setToasts((prev) => [...prev, { id, message, type }]);

      // Auto remove after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    window.addEventListener("rtm-toast", handleToastEvent);
    return () => {
      window.removeEventListener("rtm-toast", handleToastEvent);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className={styles.toastContainer}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${styles[toast.type]} glass-effect`}
          onClick={() => removeToast(toast.id)}
        >
          <svg className={styles.icon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            {toast.type === "success" && <path d="m8.5 12.5 2.5 2.5 4.5-5" />}
            {toast.type === "error" && <path d="M12 7.5v5M12 16h.01" />}
            {toast.type === "info" && <path d="M12 11v5M12 8h.01" />}
          </svg>
          <span className={styles.message}>{toast.message}</span>
          <button className={styles.closeBtn}>&times;</button>
        </div>
      ))}
    </div>
  );
}
