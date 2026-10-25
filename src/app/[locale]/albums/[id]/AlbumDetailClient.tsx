"use client";

import { useEffect, useState, useCallback } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import Cover3D from "@/components/Cover3D/Cover3D";
import RatingStars from "@/components/RatingStars/RatingStars";
import ReviewCard from "@/components/ReviewCard/ReviewCard";
import ReviewForm from "@/components/ReviewForm/ReviewForm";
import ShareModal from "@/components/ShareModal/ShareModal";
import AddToListModal from "@/components/AddToListModal/AddToListModal";
import styles from "./page.module.css";
import { showToast } from "@/components/Toast/ToastListener";
import MobileRatingSheet from "@/components/MobileRatingSheet/MobileRatingSheet";
import SliderRating from "@/components/SliderRating/SliderRating";
import { useLazyIframe } from "@/hooks/useLazyIframe";
import AccessibleDialog from "@/components/AccessibleDialog/AccessibleDialog";
import Button from "@/components/Button/Button";

interface Track {
  title: string;
  duration: string;
  preview?: string;
}

interface Review {
  id: string;
  content: string;
  ratingValue: number;
  createdAt: string;
  user: {
    id: string;
    username: string;
    profileColor?: string | null;
    profileImage?: string | null;
  };
  favoriteTrack?: string | null;
  likesCount?: number;
  commentsCount?: number;
  likedByUser?: boolean;
}

interface MusicItemDetail {
  id: string;
  title: string;
  artist: string;
  type: string;
  coverUrl: string;
  releaseYear: number;
  tracks: Track[] | null;
  reviews: Review[];
  reviewsNextCursor?: string | null;
  reviewsHasNextPage?: boolean;
  stats: {
    averageRating: number;
    totalRatings: number;
    totalReviews: number;
  };
}

interface User {
  id: string;
  username: string;
}

export default function AlbumDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("Album");
  const common = useTranslations("Common");
  const locale = useLocale();
  const [album, setAlbum] = useState<MusicItemDetail | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favTrack, setFavTrack] = useState<string | null>(null);
  const [isListenLater, setIsListenLater] = useState(false);
  const [currentUserRating, setCurrentUserRating] = useState<number | null>(null);
  const [isDiaryOpen, setIsDiaryOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [diaryRating, setDiaryRating] = useState("5");
  const [diaryNotes, setDiaryNotes] = useState("");
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [ratingFeedbackId, setRatingFeedbackId] = useState(0);
  const [ratingFeedbackValue, setRatingFeedbackValue] = useState<number | null>(null);
  const [favoriteTrackFeedback, setFavoriteTrackFeedback] = useState<{
    trackTitle: string;
    added: boolean;
  } | null>(null);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);

  // Lazy-load the Deezer iframe only when it enters the viewport
  const deezerSrc = album
    ? `https://www.deezer.com/plugins/player?format=classic&autoplay=false&playlist=false&width=100%&height=350&color=10b981&layout=dark&size=medium&type=album&id=${album.id}`
    : "";
  const { containerRef: deezerRef, activeSrc: deezerActiveSrc } = useLazyIframe(deezerSrc);

  const fetchAlbumDetails = useCallback(async (cursor?: string | null, append = false) => {
    try {
      const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const res = await fetch(`/api/music/${id}?t=${Date.now()}${query}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(t("notFound"));
      }
      const data = await res.json();
      setAlbum((previous) => append && previous ? { ...data, reviews: [...previous.reviews, ...data.reviews] } : data);
      setFavTrack(data.favoriteTrack || null);
      setIsListenLater(data.isListenLater || false);
      setCurrentUserRating(data.currentUserRating || null);
    } catch (e: any) {
      setError(t("notFound"));
    }
  }, [id, t]);

  const loadMoreReviews = async () => {
    if (!album?.reviewsHasNextPage || !album.reviewsNextCursor || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try { await fetchAlbumDetails(album.reviewsNextCursor, true); } finally { setLoadingMoreReviews(false); }
  };

  const handleListenLaterToggle = async () => {
    if (!user) {
      router.push("/login");
      return;
    }
    try {
      const method = isListenLater ? "DELETE" : "POST";
      const url = isListenLater ? `/api/listen-later/${id}` : "/api/listen-later";
      const body = isListenLater ? undefined : JSON.stringify({ musicItemId: id });

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (res.ok) {
        setIsListenLater(!isListenLater);
        showToast(isListenLater ? t("removedLater") : t("addedLater"), "success");
      }
    } catch (e) {
      console.error(e);
      showToast(common("connectionError"), "error");
    }
  };

  const handleQuickRate = async (value: number) => {
    if (!user) {
      showToast(t("loginToRate"), "error");
      return;
    }
    try {
      const res = await fetch(`/api/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicItemId: id, value }),
      });

      if (res.ok) {
        setCurrentUserRating(value);
        setRatingFeedbackValue(value);
        setRatingFeedbackId((current) => current + 1);
        showToast(t("ratingSaved"), "success");
        await fetchAlbumDetails();
      } else {
        const data = await res.json();
        showToast(common("connectionError"), "error");
      }
    } catch (e) {
      console.error(e);
      showToast(common("connectionError"), "error");
    }
  };

  const handleLogDiary = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicItemId: id,
          ratingValue: parseFloat(diaryRating),
          notes: diaryNotes,
        }),
      });
      if (res.ok) {
        setIsDiaryOpen(false);
        setDiaryNotes("");
        setDiaryRating("5");
        showToast(t("savedToDiary"), "success");
      } else {
        const data = await res.json();
        showToast(common("connectionError"), "error");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFavoriteTrackClick = async (trackTitle: string) => {
    if (!user) return;

    const isCurrentFav = favTrack === trackTitle;
    setFavTrack(isCurrentFav ? null : trackTitle);

    try {
      const method = isCurrentFav ? "DELETE" : "POST";
      const res = await fetch(`/api/music/${id}/favorite-track`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: isCurrentFav ? undefined : JSON.stringify({ trackTitle }),
      });
      if (!res.ok) {
        setFavTrack(isCurrentFav ? trackTitle : null);
      } else {
        setFavoriteTrackFeedback({ trackTitle, added: !isCurrentFav });
        // Re-fetch to pull updated community reviews with this track highlighted
        await fetchAlbumDetails();
      }
    } catch (e) {
      console.error("Error toggling favorite track:", e);
      setFavTrack(isCurrentFav ? trackTitle : null);
    }
  };

  const handleShare = () => {
    setIsShareOpen(true);
  };


  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const userRes = await fetch("/api/auth/me", { cache: "no-store" });
        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData.user ?? null);
        } else {
          console.error("Authentication state unavailable", { status: userRes.status });
        }

        await fetchAlbumDetails();
      } catch (e) {
        console.error("Initialization error:", e);
      } finally {
        setLoading(false);
      }
    }
    if (id) init();
  }, [id, fetchAlbumDetails]);

  if (loading) {
    return <div className={styles.loadingContainer}>{t("loading")}</div>;
  }

  if (error || !album) {
    return (
      <div className={styles.errorContainer}>
        <h2>{error || t("notFound")}</h2>
        <Link href="/" className="secondary-btn" style={{ marginTop: "20px", display: "inline-block" }}>
          {common("backToHome")}
        </Link>
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.detailGrid}>
        {/* Identity and actions come first in the DOM for reading and keyboard order. */}
          {/* Deezer Album Player Widget — carga diferida con IntersectionObserver */}
        <section className={styles.rightCol}>
          <header className={styles.header}>
            <h1 className={styles.title}>{album.title}</h1>
            <p className={styles.artistSub}>
              {t("byArtist")} <Link href={`/artists/${encodeURIComponent(album.artist)}`}>{album.artist}</Link> • {album.releaseYear}
            </p>
            
            <div className={styles.actionsBar} style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
              {user && (
                <div className={styles.ratingAction} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "rgba(255, 255, 255, 0.03)",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}>
                  <div className={styles.desktopRating}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 600 }}>{t("rate")}:</span>
                    <RatingStars
                      value={currentUserRating || 0}
                      onChange={handleQuickRate}
                      interactive={true}
                      size={20}
                      feedbackValue={ratingFeedbackValue}
                      feedbackId={ratingFeedbackId}
                    />
                  </div>
                  <div className={styles.mobileRating}>
                    <span className={styles.mobileRatingText}>
                      {currentUserRating ? t("yourRating", {rating: currentUserRating}) : t("rateAlbum")}
                    </span>
                    <SliderRating
                      value={currentUserRating || 0.5}
                      onChange={(val) => setCurrentUserRating(val)}
                      onChangeComplete={handleQuickRate}
                      size={28}
                      feedbackValue={ratingFeedbackValue}
                      feedbackId={ratingFeedbackId}
                    />
                  </div>
                </div>
              )}
              <button
                onClick={handleShare}
                className={styles.actionBtn}
                style={{
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  transition: "all var(--transition-fast)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                  {t("share")}
                </div>
              </button>

              {user && (
                <>
                  <button
                    onClick={handleListenLaterToggle}
                    className={`${styles.actionBtn} ${isListenLater ? styles.actionBtnActive : ""}`}
                    style={{
                      background: isListenLater ? "rgba(16, 185, 129, 0.1)" : "transparent",
                      color: isListenLater ? "var(--primary)" : "var(--text-secondary)",
                      border: `1px solid ${isListenLater ? "var(--primary)" : "var(--border)"}`,
                      padding: "8px 16px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      transition: "all var(--transition-fast)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {isListenLater ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                      )}
                      {isListenLater ? t("savedLater") : t("listenLater")}
                    </div>
                  </button>
                  <button
                    onClick={() => setIsDiaryOpen(true)}
                    className={styles.actionBtn}
                    style={{
                      background: "transparent",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      transition: "all var(--transition-fast)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                      </svg>
                      {t("addToDiary")}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      if (!user) router.push("/login");
                      else setIsListModalOpen(true);
                    }}
                    className={styles.actionBtn}
                    style={{
                      background: "transparent",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      transition: "all var(--transition-fast)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                      </svg>
                      {t("addToList")}
                    </div>
                  </button>
                </>
              )}
            </div>
          </header>
        </section>

        <section className={styles.leftCol}>
          <div className={styles.coverStage}>
            {album.coverUrl && (
              <>
                <div className={styles.coverAuraAccent} aria-hidden="true" />
                <div className={styles.coverAura} aria-hidden="true">
                  {/* Decorative duplicate of the already rendered cover; it is intentionally not a second image component. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={album.coverUrl} alt="" />
                </div>
              </>
            )}
            <div className={styles.coverForeground}>
              <Cover3D src={album.coverUrl} alt={album.title} size={320} />
            </div>
          </div>

          <div className={`${styles.statsCard} glass`}>
            <div className={styles.statsValue}>
              <span className={styles.average}>{album.stats.averageRating.toFixed(1)}</span>
              <RatingStars value={album.stats.averageRating} size={16} />
            </div>
            <div className={styles.statsMeta}>
              <div>{t("ratingsCount", { count: album.stats.totalRatings })}</div>
              <div>{t("reviewsCount", { count: album.stats.totalReviews })}</div>
            </div>
          </div>

          {/* Deezer Album Player Widget — carga diferida con IntersectionObserver */}
          <div
            ref={deezerRef}
            className={`${styles.playerCard} glass`}
            style={{ overflow: "hidden", minHeight: "374px" }}
          >
            {deezerActiveSrc ? (
              <iframe
                title={t("playerTitle")}
                src={deezerActiveSrc}
                width="100%"
                height="350"
                frameBorder="0"
                allowFullScreen
                allow="encrypted-media; clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-popups"
                style={{ borderRadius: "12px", border: "none", display: "block" }}
              />
            ) : (
              <div style={{
                height: "350px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: "0.85rem"
              }}>
                {t("loadingPlayer")}
              </div>
            )}
          </div>
        </section>

        <section className={styles.contentCol}>
          <section className={`${styles.tracksCard} glass`}>
            <h3 className={styles.cardTitle}>{t("trackList")}</h3>
            {album.tracks && album.tracks.length > 0 ? (
              <ol className={styles.tracklist}>
                {album.tracks.map((track, i) => {
                  const isFavorite = favTrack === track.title;
                  return (
                    <li key={i} className={`${styles.trackItem} ${isFavorite ? styles.trackItemFav : ""}`}>
                      <div className={styles.trackTitleCol}>
                        {user ? (
                          <button
                            onClick={() => handleFavoriteTrackClick(track.title)}
                            className={`${styles.favTrackBtn} ${favoriteTrackFeedback?.trackTitle === track.title
                              ? favoriteTrackFeedback.added ? styles.favTrackAdded : styles.favTrackRemoved
                              : ""}`}
                            title={isFavorite ? t("unfavoriteTrack") : t("favoriteTrack")}
                            aria-label={isFavorite ? t("unfavoriteTrack") : t("favoriteTrack")}
                          >
                            {isFavorite ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className={styles.heartIconActive}>
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                              </svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className={styles.heartIcon}>
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                              </svg>
                            )}
                          </button>
                        ) : (
                          <span className={styles.bulletDot}>•</span>
                        )}

                        <span className={styles.trackTitle}>{track.title}</span>
                      </div>
                      <span className={styles.trackDuration}>{track.duration}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={styles.noTracks}>{t("noTracks")}</p>
            )}
          </section>

          <section className={styles.reviewFormSection}>
            {user ? (
              <ReviewForm
                musicItemId={album.id}
                rating={currentUserRating || 0}
                onRatingChange={(newRating) => setCurrentUserRating(newRating)}
                onSuccess={fetchAlbumDetails}
              />
            ) : (
              <div className={`${styles.authPrompt} glass`}>
                <p>{t("ratePrompt")}</p>
                <Link
                  href="/login"
                  className="neon-btn"
                  style={{ marginTop: "12px", display: "inline-block" }}
                >
                  {t("loginToRate")}
                </Link>
              </div>
            )}
          </section>

          <section className={styles.reviewsListSection}>
            <h3 className={`section-heading ${styles.sectionHeading}`}>{t("communityReviews")}</h3>
            {album.reviews.length === 0 ? (
              <p className={styles.noReviews}>
                {t("noReviews")}
              </p>
            ) : (
              <div className={styles.reviewsStack}>
                {album.reviews.map((rev) => (
                  <ReviewCard key={rev.id} review={rev} showMusicDetails={false} />
                ))}
              </div>
            )}
            {album.reviewsHasNextPage && (
              <button type="button" className="secondary-btn" onClick={loadMoreReviews} disabled={loadingMoreReviews}>
                {loadingMoreReviews ? "Cargando…" : "Cargar más reseñas"}
              </button>
            )}
          </section>
        </section>

      </div>


      {/* Diary Modal */}
      {isDiaryOpen && (
        <AccessibleDialog
          isOpen={isDiaryOpen}
          onClose={() => setIsDiaryOpen(false)}
          labelledBy="diary-dialog-title"
          className=""
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
        >
          <div
            className="card glass"
            style={{
              width: "100%",
              maxWidth: "480px",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="diary-dialog-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                {t("diaryTitle")}
              </h3>
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => setIsDiaryOpen(false)}
                aria-label={common("close")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "1.5rem",
                  cursor: "pointer"
                }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleLogDiary} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <img src={album.coverUrl} alt={album.title} style={{ width: "45px", height: "45px", borderRadius: "6px", objectFit: "cover" }} />
                <div>
                  <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.9rem" }}>{album.title}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>{album.artist}</div>
                </div>
              </div>

              {/* Rating */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", fontWeight: 700 }}>
                  {t("ratingLabel")}
                </label>
                <select
                  value={diaryRating}
                  onChange={(e) => setDiaryRating(e.target.value)}
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    fontSize: "0.9rem"
                  }}
                >
                  <option value="5">★★★★★ (5.0)</option>
                  <option value="4.5">★★★★½ (4.5)</option>
                  <option value="4">★★★★☆ (4.0)</option>
                  <option value="3.5">★★★½☆ (3.5)</option>
                  <option value="3">★★★☆☆ (3.0)</option>
                  <option value="2.5">★★½☆☆ (2.5)</option>
                  <option value="2">★★☆☆☆ (2.0)</option>
                  <option value="1.5">★½☆☆☆ (1.5)</option>
                  <option value="1">★☆☆☆☆ (1.0)</option>
                  <option value="0.5">½☆☆☆☆ (0.5)</option>
                </select>
              </div>

              {/* Notes */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", fontWeight: 700 }}>
                  {t("notesLabel")}
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={diaryNotes}
                  onChange={(e) => setDiaryNotes(e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    fontSize: "0.9rem",
                    resize: "none",
                    fontFamily: "inherit"
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "10px" }}>
                <Button variant="secondary" onClick={() => setIsDiaryOpen(false)}>
                  {common("cancel")}
                </Button>
                <Button type="submit" variant="neon">
                  {common("save")}
                </Button>
              </div>
            </form>
          </div>
        </AccessibleDialog>
      )}

      {/* Share Modal */}
      {album && (
        <ShareModal
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          album={{
            title: album.title,
            artist: album.artist,
            releaseYear: album.releaseYear,
            coverUrl: album.coverUrl,
          }}
          shareUrl={typeof window !== "undefined" ? window.location.href : `https://ridethemusic.vercel.app/${locale}/albums/${id}`}
        />
      )}

      {user && (
        <AddToListModal
          isOpen={isListModalOpen}
          onClose={() => setIsListModalOpen(false)}
          musicItemId={album.id}
          username={user.username}
        />
      )}

      <MobileRatingSheet
        isOpen={isMobileSheetOpen}
        onClose={() => setIsMobileSheetOpen(false)}
        albumTitle={album.title}
        currentRating={currentUserRating}
        onRate={handleQuickRate}
      />
    </main>
  );
}
