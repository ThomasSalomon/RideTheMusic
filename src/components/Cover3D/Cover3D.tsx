"use client";

import React, { useRef, useEffect, useState } from "react";
import styles from "./Cover3D.module.css";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getCoverTilt } from "@/utils/cover-tilt";

interface Cover3DProps {
  src: string;
  alt: string;
  size?: number | string;
}

export default function Cover3D({ src, alt, size = 300 }: Cover3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [imageFailed, setImageFailed] = useState(false);
  const showFallback = !src || imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  // Cache the bounding rect to avoid layout thrashing on mousemove
  const rectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      rectRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (cardRef.current) cardRef.current.style.transform = "rotateX(0deg) rotateY(0deg) scale(1)";
      if (glowRef.current) glowRef.current.style.background = "transparent";
      return;
    }

    const handleScroll = () => {
      rectRef.current = null;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [prefersReducedMotion]);

  const handleMouseEnter = () => {
    if (containerRef.current) {
      rectRef.current = containerRef.current.getBoundingClientRect();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion) return;
    const card = cardRef.current;
    const glow = glowRef.current;
    if (!card) return;

    // Fallback if mouseenter was missed
    if (!rectRef.current && containerRef.current) {
      rectRef.current = containerRef.current.getBoundingClientRect();
    }
    if (!rectRef.current) return;

    const rect = rectRef.current;
    const x = e.clientX - rect.left; // cursor x relative to card
    const y = e.clientY - rect.top;  // cursor y relative to card

    const tilt = getCoverTilt(false, { x, y, width: rect.width, height: rect.height });

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      card.style.transform = tilt.transform;
      if (glow) {
        glow.style.background = tilt.glow;
      }
    });
  };

  const handleMouseLeave = () => {
    if (prefersReducedMotion) return;
    const card = cardRef.current;
    const glow = glowRef.current;
    rectRef.current = null; // Clear cache on leave
    if (!card) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      card.style.transform = "rotateX(0deg) rotateY(0deg) scale(1)";
      if (glow) {
        glow.style.background = "transparent";
      }
    });
  };

  const sizeStyle = typeof size === "number" ? `${size}px` : size;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseEnter={prefersReducedMotion ? undefined : handleMouseEnter}
      onMouseMove={prefersReducedMotion ? undefined : handleMouseMove}
      onMouseLeave={prefersReducedMotion ? undefined : handleMouseLeave}
      style={{ width: sizeStyle, aspectRatio: "1 / 1" }}
    >
      <div ref={cardRef} className={styles.card}>
        <div ref={glowRef} className={styles.glow} />
        {showFallback ? (
          <div className={styles.fallback} role="img" aria-label={alt}>
            <svg viewBox="0 0 64 64" aria-hidden="true" className={styles.fallbackIcon}>
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
              <circle cx="32" cy="32" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
        ) : (
          <img src={src} alt={alt} className={styles.image} loading="lazy" onError={() => setImageFailed(true)} />
        )}
      </div>
    </div>
  );
}
