"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import styles from "./page.module.css";
import Avatar from "@/components/Avatar/Avatar";
import Cover3D from "@/components/Cover3D/Cover3D";
import Button from "@/components/Button/Button";
import { MOTION_DURATION, MOTION_EASE, reducedMotionDuration } from "@/utils/motion";

type Tab = "albums" | "artists" | "users";

export default function ExploreTabs() {
  const t = useTranslations("Explore");
  const common = useTranslations("Common");
  const prefersReducedMotion = useReducedMotion();
  const motionId = useId();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ albums: null, artists: null, users: null });
  const [activeTab, setActiveTab] = useState<Tab>("artists");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [users, setUsers] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setPage(0);
    const timer = setTimeout(() => {
      fetchData(activeTab, searchQuery, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  const fetchData = async (tab: Tab, query: string, pageIndex: number) => {
    const setBusy = pageIndex === 0 ? setLoading : setLoadingMore;
    try {
      setBusy(true);
      setLoadError(false);
      const isQueryEmpty = query.trim().length === 0;
      setIsSearching(!isQueryEmpty);

      const limit = 50;
      const index = pageIndex * limit;
      const queryParams = `index=${index}&limit=${limit}`;

      if (tab === "users") {
        const url = `/api/users/search?q=${encodeURIComponent(query)}&${queryParams}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`User search failed: ${res.status}`);
        const data = await res.json();
        setUsers(pageIndex === 0 ? data : (prev) => [...prev, ...data]);
        setHasMore(data.length === limit);
      } else if (tab === "albums") {
        const url = isQueryEmpty ? `/api/music?${queryParams}` : `/api/music?q=${encodeURIComponent(query)}&${queryParams}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Album search failed: ${res.status}`);
        const data = await res.json();
        setAlbums(pageIndex === 0 ? data : (prev) => [...prev, ...data]);
        setHasMore(data.length === limit);
      } else if (tab === "artists") {
        const url = isQueryEmpty ? `/api/artists/search?${queryParams}` : `/api/artists/search?q=${encodeURIComponent(query)}&${queryParams}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Artist search failed: ${res.status}`);
        const data = await res.json();
        setArtists(pageIndex === 0 ? data : (prev) => [...prev, ...data]);
        setHasMore(data.length === limit);
      }
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchData(activeTab, searchQuery, nextPage);
  };

  const renderPlaceholder = () => {
    if (activeTab === "albums") return t("searchAlbums");
    if (activeTab === "artists") return t("searchArtists");
    return t("searchUsers");
  };

  const renderSectionTitle = () => {
    if (isSearching) return t("searchResults");
    if (activeTab === "albums") return t("popularAlbums");
    if (activeTab === "artists") return t("popularArtists");
    return t("popularUsers");
  };

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    tabRefs.current[tab]?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: Tab) => {
    const tabs: Tab[] = ["albums", "artists", "users"];
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    tabRefs.current[tabs[nextIndex]]?.focus();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "albums", label: t("albums") },
    { id: "artists", label: t("artists") },
    { id: "users", label: t("users") },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </div>

      <div className={styles.tabsContainer}>
        <div className={styles.tabs} role="tablist" aria-label={t("title")}>
          {tabs.map(({ id, label }) => {
            const isActive = activeTab === id;

            return (
              <button
                key={id}
                ref={(element) => { tabRefs.current[id] = element; }}
                id={`explore-tab-${id}`}
                role="tab"
                aria-selected={isActive}
                aria-controls="explore-results"
                tabIndex={isActive ? 0 : -1}
                className={`${styles.tab} ${isActive ? styles.activeTab : ""}`}
                onClick={() => selectTab(id)}
                onKeyDown={(event) => handleTabKeyDown(event, id)}
              >
                {label}
                {isActive && (
                  <motion.span
                    aria-hidden="true"
                    className={styles.tabIndicator}
                    layoutId={`explore-tab-indicator-${motionId}`}
                    transition={{
                      duration: reducedMotionDuration(Boolean(prefersReducedMotion), MOTION_DURATION.fast),
                      ease: MOTION_EASE.expressive,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.searchSection}>
        <input
          type="text"
          placeholder={renderPlaceholder()}
          aria-label={renderPlaceholder()}
          className={styles.searchInput}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div id="explore-results" role="tabpanel" aria-labelledby={`explore-tab-${activeTab}`}>
        <h2 className={`section-heading ${styles.sectionTitle}`}>{renderSectionTitle()}</h2>

        {loading ? (
          <ExploreSkeleton tab={activeTab} label={common("loading")} />
        ) : loadError && page === 0 ? (
          <div className={styles.statusBox} role="alert">
            <span>{common("error")}</span>
            <button type="button" className={styles.retryButton} onClick={() => fetchData(activeTab, searchQuery, 0)}>{common("retry")}</button>
          </div>
        ) : (
          <>
            {activeTab === "users" && users.length === 0 && (
              <div className={styles.statusBox}>{t("noUsers")}</div>
            )}
            {activeTab === "users" && users.length > 0 && (
              <div className={styles.usersGrid}>
                {users.map((user) => (
                  <Link href={`/users/${user.username}`} key={user.username} className={styles.userCard}>
                    <Avatar
                      username={user.username}
                      profileColor={user.profileColor}
                      profileImage={user.profileImage}
                      size={80}
                      style={{ boxShadow: "var(--shadow-sm)" }}
                    />
                    <h3 className={styles.username}>@{user.username}</h3>
                    <div className={styles.userStats}>
                      <div className={styles.stat}>
                        <span className={styles.statValue}>{user._count?.followers || 0}</span>
                        <span>{t("followers")}</span>
                      </div>
                      <div className={styles.stat}>
                        <span className={styles.statValue}>{user._count?.reviews || 0}</span>
                        <span>{t("reviews")}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {activeTab === "albums" && albums.length === 0 && (
              <div className={styles.statusBox}>{t("noAlbums")}</div>
            )}
            {activeTab === "albums" && albums.length > 0 && (
              <div className={styles.albumsGrid}>
                {albums.map((item) => (
                  <div key={item.id} className={styles.albumCard}>
                    <Link href={`/albums/${item.id}`}>
                      <Cover3D src={item.coverUrl} alt={item.title} size="100%" />
                    </Link>
                    <div className={styles.albumMeta}>
                      <Link href={`/albums/${item.id}`} className={styles.albumTitle}>
                        {item.title}
                      </Link>
                      <Link href={`/artists/${encodeURIComponent(item.artist)}`} className={styles.albumArtist}>
                        {item.artist}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "artists" && artists.length === 0 && (
              <div className={styles.statusBox}>{t("noArtists")}</div>
            )}
            {activeTab === "artists" && artists.length > 0 && (
              <div className={styles.artistsGrid}>
                {artists.map((artist) => (
                  <Link href={`/artists/${artist.id}`} key={artist.id} className={styles.artistCard}>
                    <div className={styles.artistImageContainer}>
                      <img
                        src={artist.pictureUrl}
                        alt=""
                        className={styles.artistImage}
                        loading="lazy"
                      />
                    </div>
                    <span className={styles.artistName}>{artist.name}</span>
                  </Link>
                ))}
              </div>
            )}
            {loadError && page > 0 && (
              <div className={styles.statusBox} role="alert">
                <span>{common("error")}</span>
                <button type="button" className={styles.retryButton} onClick={() => fetchData(activeTab, searchQuery, page)}>{common("retry")}</button>
              </div>
            )}
            {hasMore && !loadError && (
              <div className={styles.loadMoreRow}>
                <Button
                  onClick={loadMore}
                  isLoading={loadingMore}
                  loadingLabel={common("loading")}
                >
                  {common("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ExploreSkeleton({ tab, label }: { tab: Tab; label: string }) {
  const placeholders = Array.from({ length: tab === "users" ? 6 : 10 }, (_, index) => index);

  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {tab === "albums" && (
        <div className={styles.albumsGrid} aria-hidden="true">
          {placeholders.map((index) => (
            <div key={index} className={styles.albumCard}>
              <span className={`skeleton ${styles.skeletonCover}`} />
              <span className="skeleton" style={{ width: "80%", height: 14 }} />
              <span className="skeleton" style={{ width: "50%", height: 12 }} />
            </div>
          ))}
        </div>
      )}
      {tab === "artists" && (
        <div className={styles.artistsGrid} aria-hidden="true">
          {placeholders.map((index) => (
            <div key={index} className={styles.artistCard}>
              <span className={`skeleton ${styles.artistImageContainer}`} />
              <span className="skeleton" style={{ width: "60%", height: 14 }} />
            </div>
          ))}
        </div>
      )}
      {tab === "users" && (
        <div className={styles.usersGrid} aria-hidden="true">
          {placeholders.map((index) => (
            <div key={index} className={styles.userCard}>
              <span className="skeleton" style={{ width: 80, height: 80, borderRadius: "50%" }} />
              <span className="skeleton" style={{ width: "50%", height: 16, margin: "16px 0 12px" }} />
              <span className="skeleton" style={{ width: "70%", height: 28 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
