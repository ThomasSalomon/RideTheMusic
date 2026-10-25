"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import Cover3D from "@/components/Cover3D/Cover3D";
import RatingStars from "@/components/RatingStars/RatingStars";
import ReviewCard from "@/components/ReviewCard/ReviewCard";
import SpecialDayBanner from "@/components/SpecialDayBanner/SpecialDayBanner";
import { getHomeSearchHref, getSearchQuery, isHomeSearchMode } from "@/utils/home-search-url";
import { isCurrentSearchRequest } from "@/utils/search-request";
import styles from "./page.module.css";

interface MusicItem {
  id: string;
  title: string;
  artist: string;
  type: string;
  coverUrl: string;
  releaseYear: number;
  stats: {
    averageRating: number;
    totalRatings: number;
    totalReviews: number;
  };
}

interface Review {
  id: string;
  content: string;
  ratingValue: number;
  createdAt: string;
  user: { id: string; username: string; profileColor?: string | null };
  musicItem: { id: string; title: string; artist: string; coverUrl: string; type: string };
  favoriteTrack?: string | null;
  likesCount?: number;
  commentsCount?: number;
  likedByUser?: boolean;
}

interface ArtistSearchResult {
  id: string;
  name: string;
  pictureUrl: string;
}

interface SearchResponse {
  artists: ArtistSearchResult[];
  titleAlbumGroups: Array<{ primary: MusicItem; variants: MusicItem[] }>;
  featuredAlbums: MusicItem[];
  featuredArtistName: string | null;
  partial: boolean;
}

function AlbumGrid({ items }: { items: MusicItem[] }) {
  return (
    <div className={styles.albumsGrid}>
      {items.map((item) => (
        <div key={item.id} className={styles.albumCard}>
          <Link href={`/albums/${item.id}`}>
            <Cover3D src={item.coverUrl} alt={item.title} size="100%" />
          </Link>
          <div className={styles.albumMeta}>
            <Link href={`/albums/${item.id}`} className={styles.albumTitle}>{item.title}</Link>
            <Link href={`/artists/${encodeURIComponent(item.artist)}`} className={styles.albumArtist}>{item.artist}</Link>
            <div className={styles.ratingStats}>
              <RatingStars value={item.stats.averageRating} size={14} />
              <span className={styles.statsCount}>({item.stats.totalRatings})</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AlbumGridSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.albumsGrid} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={styles.albumCard} aria-hidden="true">
          <span className={`skeleton ${styles.skeletonCover}`} />
          <div className={styles.albumMeta}>
            <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "80%" }} />
            <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "50%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewListSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.reviewsList} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={styles.skeletonReview} aria-hidden="true">
          <div className={styles.skeletonReviewHeader}>
            <span className={`skeleton ${styles.skeletonAvatar}`} />
            <div className={styles.skeletonReviewMeta}>
              <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "40%" }} />
              <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "28%" }} />
            </div>
          </div>
          <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "92%" }} />
          <span className={`skeleton ${styles.skeletonLine}`} style={{ width: "64%" }} />
        </div>
      ))}
    </div>
  );
}

function AlbumMatchGrid({ groups }: { groups: SearchResponse["titleAlbumGroups"] }) {
  const t = useTranslations("Home");

  return (
    <div className={styles.albumsGrid}>
      {groups.map(({ primary, variants }) => (
        <div key={primary.id} className={styles.albumMatchGroup}>
          <AlbumGrid items={[primary]} />
          {variants.length > 0 && (
            <div className={styles.editionVariants}>
              <span className={styles.editionVariantsLabel}>{t("editionVariants")}</span>
              {variants.map((variant) => (
                <Link key={variant.id} href={`/albums/${variant.id}`} className={styles.editionVariantLink}>
                  {variant.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const t = useTranslations("Home");
  const navigationSearchParams = useSearchParams();
  const [urlSearchQuery, setUrlSearchQuery] = useState(() => getSearchQuery(navigationSearchParams));
  const [items, setItems] = useState<MusicItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [searchQuery, setSearchQuery] = useState(() => urlSearchQuery);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetryKey, setCatalogRetryKey] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string } | null>(null);
  const [activeFeed, setActiveFeed] = useState<"global" | "following">("global");
  const searchRequestId = useRef(0);
  const searchAbortController = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeSearchQuery = searchQuery.trim();
  const isSearchMode = isHomeSearchMode(activeSearchQuery);
  const isUrlSearchPending = isSearchMode && activeSearchQuery !== urlSearchQuery;

  useEffect(() => {
    const query = getSearchQuery(navigationSearchParams);
    setUrlSearchQuery(query);
    setSearchQuery(query);
  }, [navigationSearchParams]);

  useEffect(() => {
    const syncSearchFromLocation = () => {
      const query = getSearchQuery(new URLSearchParams(window.location.search));
      setUrlSearchQuery(query);
      setSearchQuery(query);
    };

    window.addEventListener("popstate", syncSearchFromLocation);
    return () => window.removeEventListener("popstate", syncSearchFromLocation);
  }, []);

  function updateSearchUrl(nextQuery: string, historyMode: "push" | "replace") {
    const href = getHomeSearchHref(
      window.location.pathname,
      new URLSearchParams(window.location.search),
      nextQuery
    );
    window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", href);
    setUrlSearchQuery(nextQuery.trim());
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (activeSearchQuery === urlSearchQuery) return;
      updateSearchUrl(activeSearchQuery, "replace");
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [activeSearchQuery, urlSearchQuery]);

  useEffect(() => {
    if (isSearchMode) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setCatalogError(false);

    async function initData() {
      try {
        const [musicRes, meRes] = await Promise.all([
          fetch("/api/music", { cache: "no-store", signal: controller.signal }),
          fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!musicRes.ok) throw new Error(`Catalog request failed: ${musicRes.status}`);
        const musicData = await musicRes.json();
        if (!controller.signal.aborted) setItems(musicData);

        if (meRes.ok && !controller.signal.aborted) {
          const meData = await meRes.json();
          setCurrentUser(meData.user);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Initialization error:", error);
          setCatalogError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    initData();
    return () => controller.abort();
  }, [catalogRetryKey, isSearchMode]);

  useEffect(() => {
    if (isSearchMode) {
      setReviewsLoading(false);
      return;
    }

    const controller = new AbortController();
    async function fetchReviews() {
      setReviewsLoading(true);
      try {
        const url = activeFeed === "following" ? "/api/reviews?feed=following" : "/api/reviews";
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!controller.signal.aborted) setReviews(res.ok ? await res.json() : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Fetch reviews error:", error);
          setReviews([]);
        }
      } finally {
        if (!controller.signal.aborted) setReviewsLoading(false);
      }
    }

    fetchReviews();
    return () => controller.abort();
  }, [activeFeed, isSearchMode]);

  useEffect(() => {
    const query = urlSearchQuery;
    const requestId = ++searchRequestId.current;

    if (!isHomeSearchMode(query)) {
      setSearchResponse(null);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }

    const controller = new AbortController();
    searchAbortController.current = controller;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(false);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Search request failed: ${res.status}`);

        const data: SearchResponse = await res.json();
        if (isCurrentSearchRequest(requestId, searchRequestId.current)) setSearchResponse(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isCurrentSearchRequest(requestId, searchRequestId.current)) {
          console.error("Search error:", error);
          setSearchError(true);
          setSearchResponse(null);
        }
      } finally {
        if (isCurrentSearchRequest(requestId, searchRequestId.current)) setSearchLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchRetryKey, urlSearchQuery]);

  const hasSearchResults = Boolean(
      searchResponse && (
        searchResponse.artists.length > 0 ||
      searchResponse.titleAlbumGroups.length > 0 ||
      searchResponse.featuredAlbums.length > 0
    )
  );

  const clearSearch = () => {
    searchRequestId.current += 1;
    searchAbortController.current?.abort();
    setSearchQuery("");
    setSearchResponse(null);
    setSearchLoading(false);
    setSearchError(false);
    if (urlSearchQuery) updateSearchUrl("", "replace");
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  return (
    <main className={`${styles.main} ${isSearchMode ? styles.searchMode : ""}`}>
      <section className={`${styles.hero} ${isSearchMode ? styles.searchHero : ""}`}>
        {!isSearchMode && (
          <>
            <h1 className={styles.heroTitle}>{t("heroTitle1")} <span>{t("heroTitleHighlight")}</span>.</h1>
            <p className={styles.heroSub}>{t("heroSubtitle")}</p>
          </>
        )}
        <form
          className={styles.searchContainer}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const nextQuery = searchQuery.trim();
            setSearchQuery(nextQuery);
            if (nextQuery !== urlSearchQuery) updateSearchUrl(nextQuery, "push");
          }}
        >
          <label className={styles.srOnly} htmlFor="home-search-input">{t("searchLabel")}</label>
          <input
            ref={searchInputRef}
            id="home-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => {
              searchRequestId.current += 1;
              searchAbortController.current?.abort();
              setSearchQuery(event.target.value);
              setSearchResponse(null);
              setSearchError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                clearSearch();
              }
            }}
            placeholder={t("searchPlaceholder")}
            className="input-field"
            aria-controls={isSearchMode ? "search-results" : undefined}
            aria-describedby={isSearchMode ? "search-results-heading" : undefined}
          />
          {searchQuery && !isSearchMode && (
            <button type="button" className={styles.clearSearchButton} onClick={clearSearch}>
              {t("clearSearch")}
            </button>
          )}
        </form>
      </section>

      {isSearchMode ? (
        <section className={styles.searchSection} aria-labelledby="search-results-heading">
          <div className={styles.searchHeader}>
            <h1 id="search-results-heading" className={styles.searchTitle}>
              {t("searchResultsFor", { query: activeSearchQuery })}
            </h1>
            <button type="button" className={styles.clearSearchButton} onClick={clearSearch}>
              {t("clearSearch")}
            </button>
          </div>

          <div id="search-results" className={styles.searchResults} aria-live="polite">
            {isUrlSearchPending || searchLoading ? (
              <div className={styles.loader} role="status">{t("searching")}</div>
            ) : searchError ? (
              <div className={styles.searchStatus} role="alert">
                <span>{t("searchError")}</span>
                <button type="button" className={styles.retryButton} onClick={() => setSearchRetryKey((key) => key + 1)}>
                  {t("retrySearch")}
                </button>
              </div>
            ) : searchResponse?.partial && !hasSearchResults ? (
              <div className={styles.searchStatus} role="alert">
                <span>{t("searchError")}</span>
                <button type="button" className={styles.retryButton} onClick={() => setSearchRetryKey((key) => key + 1)}>
                  {t("retrySearch")}
                </button>
              </div>
            ) : !hasSearchResults ? (
              <div className={styles.noResults}>
                <p>{t("noSearchResults", { query: activeSearchQuery })}</p>
                <p className={styles.searchSuggestion}>{t("searchSuggestion")}</p>
              </div>
            ) : (
              <>
                {searchResponse?.partial && <p className={styles.partialNotice}>{t("partialSearch")}</p>}
                {searchResponse && searchResponse.artists.length > 0 && (
                  <div className={styles.searchGroup}>
                    <h2 className={styles.searchGroupTitle}>{t("artists")}</h2>
                    <div className={styles.artistResults}>
                      {searchResponse.artists.map((artist) => (
                        <Link href={`/artists/${artist.id}`} key={artist.id} className={styles.artistResult}>
                          <img src={artist.pictureUrl} alt="" className={styles.artistResultImage} />
                          <span>{artist.name}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {searchResponse && searchResponse.titleAlbumGroups.length > 0 && (
                  <div className={styles.searchGroup}>
                    <h2 className={styles.searchGroupTitle}>{t("directAlbums")}</h2>
                    <AlbumMatchGrid groups={searchResponse.titleAlbumGroups} />
                  </div>
                )}
                {searchResponse && searchResponse.featuredAlbums.length > 0 && (
                  <div className={styles.searchGroup}>
                    <h2 className={styles.searchGroupTitle}>{t("albumsByArtist", { artist: searchResponse.featuredArtistName ?? searchResponse.artists[0]?.name ?? "" })}</h2>
                    <AlbumGrid items={searchResponse.featuredAlbums} />
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className={styles.specialDayContainer}><SpecialDayBanner /></div>
          <div className={styles.contentGrid}>
            <section className={styles.musicSection}>
              <h2 className={`section-heading ${styles.sectionTitle}`}>{t("popularAlbums")}</h2>
              {loading ? <AlbumGridSkeleton label={t("loadingCatalog")} /> : catalogError ? <div className={styles.searchStatus} role="alert"><span>{t("searchError")}</span><button type="button" className={styles.retryButton} onClick={() => setCatalogRetryKey((key) => key + 1)}>{t("retrySearch")}</button></div> :
                items.length === 0 ? <div className={styles.noResults}>{t("noAlbums")}</div> :
                <AlbumGrid items={items} />}
            </section>

            <section className={styles.reviewsSection}>
              <div className={styles.sectionHeader}>
                <h2 className={`section-heading ${styles.sectionTitle}`}>{t("recentActivity")}</h2>
                {currentUser && (
                  <div className={styles.tabs}>
                    <button onClick={() => setActiveFeed("global")} className={`${styles.tab} ${activeFeed === "global" ? styles.activeTab : ""}`}>{t("tabGlobal")}</button>
                    <button onClick={() => setActiveFeed("following")} className={`${styles.tab} ${activeFeed === "following" ? styles.activeTab : ""}`}>{t("tabFollowing")}</button>
                  </div>
                )}
              </div>
              {reviewsLoading ? <ReviewListSkeleton label={t("loadingReviews")} /> :
                activeFeed === "following" && !currentUser ? (
                  <div className={styles.loginPrompt}>
                    <p>{t("loginPromptFollowing")}</p>
                    <Link href="/login" className={styles.loginPromptBtn}>{t("loginBtn")}</Link>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className={styles.noReviews}>{activeFeed === "following" ? t("noReviewsFollowing") : t("noReviewsGlobal")}</div>
                ) : (
                  <div className={styles.reviewsList}>
                    {reviews.map((review) => <ReviewCard key={review.id} review={review} showMusicDetails />)}
                  </div>
                )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
