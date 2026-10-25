"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import ReviewCard from "@/components/ReviewCard/ReviewCard";
import RatingStars from "@/components/RatingStars/RatingStars";
import styles from "./page.module.css";
import { showToast } from "@/components/Toast/ToastListener";
import EditProfileModal from "@/components/EditProfileModal/EditProfileModal";
import EditFavoritesModal from "@/components/EditFavoritesModal/EditFavoritesModal";
import AccountSettingsModal from "@/components/AccountSettingsModal/AccountSettingsModal";
import Avatar from "@/components/Avatar/Avatar";
import RecapModal from "@/components/RecapModal/RecapModal";
import Button from "@/components/Button/Button";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useLocale, useTranslations } from "next-intl";
import {
  CreateListDialog,
  DeleteListDialog,
  DiaryDialog,
} from "./ProfileDialogs";
import ProfileTabNavigation from "./ProfileTabNavigation";
import {
  getProfileTab,
  getProfileTabHref,
  PROFILE_TAB_IDS,
  type ProfileTab,
} from "@/utils/profile-tabs";

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
  earnedBadges?: { badgeId: string; createdAt: string }[];
}

interface ProfileStats {
  reviewsCount: number;
  followersCount: number;
  followingCount: number;
}

interface DeezerSearchResult {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
}

const COLOR_MAP: Record<string, { bg: string; text: string; shadow: string; border: string; value: string }> = {
  emerald: { bg: "rgba(16, 185, 129, 0.1)", text: "rgb(16, 185, 129)", shadow: "rgba(16, 185, 129, 0.2)", border: "rgba(16, 185, 129, 0.3)", value: "#10b981" },
  violet: { bg: "rgba(139, 92, 246, 0.1)", text: "rgb(139, 92, 246)", shadow: "rgba(139, 92, 246, 0.2)", border: "rgba(139, 92, 246, 0.3)", value: "#8b5cf6" },
  cobalt: { bg: "rgba(59, 130, 246, 0.1)", text: "rgb(59, 130, 246)", shadow: "rgba(59, 130, 246, 0.2)", border: "rgba(59, 130, 246, 0.3)", value: "#3b82f6" },
  amber: { bg: "rgba(245, 158, 11, 0.1)", text: "rgb(245, 158, 11)", shadow: "rgba(245, 158, 11, 0.2)", border: "rgba(245, 158, 11, 0.3)", value: "#f59e0b" },
  rose: { bg: "rgba(244, 63, 94, 0.1)", text: "rgb(244, 63, 94)", shadow: "rgba(244, 63, 94, 0.2)", border: "rgba(244, 63, 94, 0.3)", value: "#f43f5e" },
  slate: { bg: "rgba(100, 116, 139, 0.1)", text: "rgb(100, 116, 139)", shadow: "rgba(100, 116, 139, 0.2)", border: "rgba(100, 116, 139, 0.3)", value: "#64748b" }
};

export default function UserProfilePage() {
  const t = useTranslations("Profile");
  const common = useTranslations("Common");
  const locale = useLocale();
  const { username } = useParams() as { username: string };
  const router = useRouter();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile data state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);

  // Auth state
  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  // Edit Modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [isRecapOpen, setIsRecapOpen] = useState(false);

  // The URL is the source of truth; this state only re-renders after native history changes.
  const [profileSearch, setProfileSearch] = useState("");
  const tabDataRequestIds = useRef<Record<Exclude<ProfileTab, "reviews">, number>>({
    lists: 0,
    diary: 0,
    stats: 0,
    "listen-later": 0,
  });
  const activeTab = getProfileTab(new URLSearchParams(profileSearch).get("tab"), isOwnProfile);
  const [lists, setLists] = useState<any[]>([]);
  const [diaryLogs, setDiaryLogs] = useState<any[]>([]);
  const [statsData, setStatsData] = useState<any | null>(null);
  const [listenLaterItems, setListenLaterItems] = useState<any[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // List Detail State
  const [selectedList, setSelectedList] = useState<any | null>(null);
  const [listToDelete, setListToDelete] = useState<string | null>(null);
  const [isEditingList, setIsEditingList] = useState(false);
  const [editListTitle, setEditListTitle] = useState("");
  const [editListDesc, setEditListDesc] = useState("");
  const [editListPublic, setEditListPublic] = useState(true);

  // Create List Modal State
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListPublic, setNewListPublic] = useState(true);

  // Add Item to List state
  const [listItemQuery, setListItemQuery] = useState("");
  const [listSearchResults, setListSearchResults] = useState<DeezerSearchResult[]>([]);
  const [listSearching, setListSearching] = useState(false);

  // Add Diary Entry Modal State
  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState(false);
  const [diaryNotes, setDiaryNotes] = useState("");
  const [diaryRating, setDiaryRating] = useState("5");
  const [diarySearchQuery, setDiarySearchQuery] = useState("");
  const [diarySearchResults, setDiarySearchResults] = useState<DeezerSearchResult[]>([]);
  const [diarySearching, setDiarySearching] = useState(false);
  const [diarySelectedAlbum, setDiarySelectedAlbum] = useState<DeezerSearchResult | null>(null);

  const availableTabs: readonly ProfileTab[] = isOwnProfile
    ? PROFILE_TAB_IDS
    : PROFILE_TAB_IDS.filter((tab) => tab !== "listen-later");

  useEffect(() => {
    const syncProfileSearch = () => setProfileSearch(window.location.search);

    syncProfileSearch();
    window.addEventListener("popstate", syncProfileSearch);
    return () => window.removeEventListener("popstate", syncProfileSearch);
  }, []);

  useEffect(() => {
    setSelectedList(null);
  }, [activeTab]);

  const selectProfileTab = useCallback((nextTab: ProfileTab) => {
    if (nextTab === "listen-later" && !isOwnProfile) return;

    const nextHref = getProfileTabHref(
      window.location.pathname,
      new URLSearchParams(window.location.search),
      nextTab
    );
    const currentHref = `${window.location.pathname}${window.location.search}`;

    if (nextHref !== currentHref) {
      window.history.pushState(null, "", nextHref);
      setProfileSearch(window.location.search);
    }
  }, [isOwnProfile]);

  const fetchLists = useCallback(async () => {
    const requestId = ++tabDataRequestIds.current.lists;
    try {
      const res = await fetch(`/api/lists?username=${username}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (tabDataRequestIds.current.lists === requestId) {
          setLists(data.items || []);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [username]);

  const fetchDiary = useCallback(async () => {
    const requestId = ++tabDataRequestIds.current.diary;
    try {
      const res = await fetch(`/api/diary?username=${username}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (tabDataRequestIds.current.diary === requestId) {
          setDiaryLogs(data.items || []);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [username]);

  const fetchStats = useCallback(async () => {
    const requestId = ++tabDataRequestIds.current.stats;
    try {
      const res = await fetch(`/api/users/${username}/stats`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (tabDataRequestIds.current.stats === requestId) {
          setStatsData(data);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [username]);

  const fetchListenLater = useCallback(async () => {
    const requestId = ++tabDataRequestIds.current["listen-later"];
    try {
      const res = await fetch("/api/listen-later", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (tabDataRequestIds.current["listen-later"] === requestId) {
          setListenLaterItems(data.items || []);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTabData() {
      if (activeTab === "reviews") {
        setLoadingTab(false);
        return;
      }

      setLoadingTab(true);
      if (activeTab === "lists") {
        await fetchLists();
      } else if (activeTab === "diary") {
        await fetchDiary();
      } else if (activeTab === "stats") {
        await fetchStats();
      } else if (activeTab === "listen-later") {
        await fetchListenLater();
      }

      if (!cancelled) {
        setLoadingTab(false);
      }
    }

    loadTabData();
    return () => {
      cancelled = true;
    };
  }, [activeTab, fetchLists, fetchDiary, fetchStats, fetchListenLater]);

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newListTitle,
          description: newListDesc,
          isPublic: newListPublic,
        }),
      });
      if (res.ok) {
        setIsCreateListOpen(false);
        setNewListTitle("");
        setNewListDesc("");
        setNewListPublic(true);
        await fetchLists();
        showToast(t("listCreated"), "success");
      } else {
        showToast(t("createListError"), "error");
      }
    } catch (e) {
      console.error(e);
      showToast(common("connectionError"), "error");
    }
  };

  const handleSelectList = useCallback(async (listId: string) => {
    try {
      setLoadingTab(true);
      const res = await fetch(`/api/lists/${listId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSelectedList(data);
        setIsEditingList(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingTab(false);
    }
  }, []);

  const handleEditListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedList) return;
    try {
      const res = await fetch(`/api/lists/${selectedList.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editListTitle,
          description: editListDesc,
          isPublic: editListPublic,
        }),
      });
      if (res.ok) {
        setIsEditingList(false);
        showToast(t("listUpdated"), "success");
        await handleSelectList(selectedList.id);
        await fetchLists();
      } else {
        showToast(t("operationError"), "error");
      }
    } catch (error) {
      console.error(error);
      showToast(common("connectionError"), "error");
    }
  };

  const handleDeleteList = useCallback((listId: string) => {
    setListToDelete(listId);
  }, []);

  const executeDeleteList = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
      if (res.ok) {
        showToast(t("listDeleted"), "success");
        setSelectedList(null);
        await fetchLists();
      } else {
        showToast(t("operationError"), "error");
      }
    } catch (e) {
      console.error(e);
      showToast(common("connectionError"), "error");
    }
  }, [common, fetchLists, t]);

  const handleAddItemToList = useCallback(async (album: DeezerSearchResult) => {
    if (!selectedList) return;
    try {
      const res = await fetch(`/api/lists/${selectedList.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicItemId: album.id }),
      });
      if (res.ok) {
        showToast(t("albumAdded"), "success");
        setListItemQuery("");
        setListSearchResults([]);
        await handleSelectList(selectedList.id);
        await fetchLists();
      } else {
        showToast(t("addToListError"), "error");
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedList, fetchLists, handleSelectList, t]);

  const handleRemoveItemFromList = useCallback(async (musicItemId: string) => {
    if (!selectedList) return;
    try {
      const res = await fetch(`/api/lists/${selectedList.id}/items/${musicItemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast(t("albumRemoved"), "success");
        await handleSelectList(selectedList.id);
        await fetchLists();
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedList, fetchLists, handleSelectList, t]);

  const handleRemoveFromListenLater = useCallback(async (musicItemId: string) => {
    try {
      const res = await fetch(`/api/listen-later/${musicItemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast(t("listenLaterRemoved"), "success");
        setListenLaterItems(prev => prev.filter(item => item.musicItemId !== musicItemId));
      } else {
        showToast(t("operationError"), "error");
      }
    } catch (e) {
      console.error(e);
      showToast(common("connectionError"), "error");
    }
  }, [common, t]);

  const handleCreateDiaryLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!diarySelectedAlbum) {
      showToast(t("selectAlbum"), "error");
      return;
    }
    try {
      const res = await fetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicItemId: diarySelectedAlbum.id,
          ratingValue: parseFloat(diaryRating),
          notes: diaryNotes,
        }),
      });
      if (res.ok) {
        showToast(t("diarySaved"), "success");
        setIsDiaryModalOpen(false);
        setDiaryNotes("");
        setDiaryRating("5");
        setDiarySelectedAlbum(null);
        setDiarySearchQuery("");
        setDiarySearchResults([]);
        await fetchDiary();
      } else {
        showToast(t("operationError"), "error");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // List Search album trigger
  useEffect(() => {
    if (!listItemQuery || listItemQuery.trim() === "") {
      setListSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setListSearching(true);
      try {
        const res = await fetch(`/api/music?q=${encodeURIComponent(listItemQuery)}`);
        if (!res.ok) throw new Error(`Music search failed: ${res.status}`);
        const data = await res.json();
        setListSearchResults(data.slice(0, 5));
      } catch (e) {
        console.error(e);
        showToast(common("connectionError"), "error");
      } finally {
        setListSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [listItemQuery]);

  // Diary Search album trigger
  useEffect(() => {
    if (!diarySearchQuery || diarySearchQuery.trim() === "") {
      setDiarySearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setDiarySearching(true);
      try {
        const res = await fetch(`/api/music?q=${encodeURIComponent(diarySearchQuery)}`);
        if (!res.ok) throw new Error(`Music search failed: ${res.status}`);
        const data = await res.json();
        setDiarySearchResults(data.slice(0, 5));
      } catch (e) {
        console.error(e);
        showToast(common("connectionError"), "error");
      } finally {
        setDiarySearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [diarySearchQuery]);

  const fetchProfileData = useCallback(async () => {
    try {
      // 1. Fetch profile information
      const profileRes = await fetch(`/api/users/${username}`, { cache: "no-store" });
      if (!profileRes.ok) {
        if (profileRes.status === 404) {
          throw new Error(t("profileNotFound"));
        }
        throw new Error(t("loadError"));
      }
      const profileData = await profileRes.json();
      setProfile(profileData.profile);
      setStats(profileData.stats);
      setIsFollowing(profileData.isFollowing);

      // 2. Fetch user's reviews
      const reviewsRes = await fetch(`/api/reviews?username=${username}`, { cache: "no-store" });
      if (reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        setReviews(reviewsData);
      }
    } catch (e: any) {
      setError(e.message || common("error"));
    }
  }, [common, t, username]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);

      try {
        // Fetch current user auth status
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUser(meData.user);
          setIsOwnProfile(meData.user?.username === username);
        }

        await fetchProfileData();
      } catch (e: any) {
        setError(e.message || t("networkError"));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [username, fetchProfileData, t]);

  // Initializing edit state when modal opens
  const openEditModal = () => {
    setIsEditOpen(true);
  };

  // Follow/Unfollow action
  const handleFollowToggle = async () => {
    if (!currentUser) {
      router.push("/login");
      return;
    }

    if (followPending) return;
    setFollowPending(true);
    try {
      const method = isFollowing ? "DELETE" : "POST";
      const res = await fetch(`/api/users/${username}/follow`, { method });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.following);
        setStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            followersCount: data.followersCount,
          };
        });
      }
    } catch (e) {
      console.error("Follow error:", e);
    } finally {
      setFollowPending(false);
    }
  };



  if (loading) {
    return (
      <div className={styles.profilePage} role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className={`${styles.profileHeader} ${styles.profileSkeleton}`} aria-hidden="true">
          <div className={styles.userInfo}>
            <span className={`skeleton ${styles.skeletonAvatar}`} />
            <div className={styles.skeletonLines}>
              <span className="skeleton" style={{ width: 180, height: 24 }} />
              <span className="skeleton" style={{ width: 130, height: 12 }} />
            </div>
          </div>
          <div className={styles.skeletonStats}>
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} className="skeleton" style={{ width: 64, height: 36 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className={styles.profilePage}>
        <div className={styles.profileEmptyState}>
          <h2>
             {error || t("profileNotFound")}
          </h2>
          <p>
             {t("profileNotFoundDescription")}
          </p>
          <Link href="/" className="neon-btn" style={{ display: "inline-flex", alignItems: "center" }}>
             {common("backToHome")}
          </Link>
        </div>
      </div>
    );
  }

  const theme = COLOR_MAP[profile.profileColor || "emerald"] || COLOR_MAP.emerald;
  const joinYear = new Date(profile.createdAt).getFullYear();

  return (
    <div
      className={styles.profilePage}
      style={
        {
          "--profile-theme-color": theme.value,
          "--profile-theme-bg": theme.bg,
          "--profile-theme-border": theme.border,
          "--profile-theme-shadow": theme.shadow
        } as React.CSSProperties
      }
    >
      <div className={`${styles.mainContentWrapper} ${isEditOpen || isFavoritesOpen || isCreateListOpen || isDiaryModalOpen || !!listToDelete || isRecapOpen || isAccountSettingsOpen ? styles.blurredBackground : ""}`}>
      {/* Header card */}
      <header className={styles.profileHeader}>
        <div className={styles.headerMain}>
          <div className={styles.userInfo}>
            <Avatar
              username={profile.username}
              profileColor={profile.profileColor}
              profileImage={profile.profileImage}
              size={80}
              className={styles.avatar}
              style={{ border: "none" }}
            />
            <div className={styles.userMeta}>
              <h1 className={styles.username}>@{profile.username}</h1>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px", flexWrap: "wrap" }}>
                <span className={styles.joinDate}>{t("memberSince", { date: joinYear })}</span>
                {profile.favoriteGenre && (
                  <span className={styles.genreTag}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13"></path>
                      <circle cx="6" cy="18" r="3"></circle>
                      <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                    {profile.favoriteGenre}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            {isOwnProfile ? (
              <div style={{ display: "flex", gap: "10px" }}>
                <button 
                  onClick={() => setIsAccountSettingsOpen(true)} 
                  className={styles.iconBtn}
                  aria-label={t("accountSettings")}
                  title={t("accountSettings")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>
                <button onClick={openEditModal} className={`${styles.actionBtn} ${styles.editBtn}`}>
                  {t("editProfile")}
                </button>
              </div>
            ) : (
              <button
                onClick={handleFollowToggle}
                disabled={followPending}
                className={`${styles.actionBtn} ${
                  isFollowing ? styles.unfollowBtn : styles.followBtn
                }`}
              >
                {isFollowing ? t("following") : t("follow")}
              </button>
            )}
          </div>
        </div>

        {/* Bio */}
        <div className={styles.bioSection}>
          <h4 className={styles.bioTitle}>{t("biography")}</h4>
          {profile.bio?.trim() ? (
            <p className={styles.bioText}>{profile.bio}</p>
          ) : (
            <p className={styles.bioPlaceholder}>
              {isOwnProfile ? t("emptyOwnBio") : t("emptyPublicBio")}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{stats?.reviewsCount || 0}</span>
            <span className={styles.statLabel}>{t("reviews")}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{stats?.followersCount || 0}</span>
            <span className={styles.statLabel}>{t("followers")}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{stats?.followingCount || 0}</span>
            <span className={styles.statLabel}>{t("following")}</span>
          </div>
        </div>

        {/* Badges */}
        {profile.earnedBadges && profile.earnedBadges.length > 0 && (
          <div className={styles.badgesSection} style={{ marginTop: "20px", display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
            {profile.earnedBadges.map(badge => (
              <div 
                key={badge.badgeId} 
                className={styles.badgeCard}
                title={t("badgeEarned", { date: new Date(badge.createdAt).toLocaleDateString(locale) })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "var(--profile-theme-bg, rgba(255,255,255,0.05))",
                  border: "1px solid var(--profile-theme-border, var(--border))",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: "var(--text-primary)"
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>
                  {badge.badgeId === "FIRST_REVIEW" && "🏆"}
                  {/* Add more badge mappings here later */}
                </span>
                <span>
                  {badge.badgeId === "FIRST_REVIEW" && t("firstReviewBadge")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.recapBtnContainer}>
          <button 
            onClick={() => setIsRecapOpen(true)}
            className={styles.recapBtn}
          >
            <svg className={styles.recapBtnIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t("recap")} {new Date().getFullYear()}
          </button>
        </div>
      </header>

      <ProfileTabNavigation
        activeTab={activeTab}
        availableTabs={availableTabs}
        onSelect={selectProfileTab}
      />

      <section
        id={`profile-tab-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`profile-tab-${activeTab}`}
        tabIndex={0}
        className={styles.tabPanel}
      >
      {loadingTab ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary)" }}>
          {t("tabLoading")}
        </div>
      ) : (
        <>
          {activeTab === "reviews" && (
            <div className={styles.profileContent}>
              {/* Left Side: Reviews */}
              <div>
                <h3 className={styles.sectionTitle}>{t("recentReviews")}</h3>
                <div className={styles.reviewsList}>
                  {reviews.length > 0 ? (
                    reviews.map((review) => (
                      <ReviewCard key={review.id} review={review} showMusicDetails={true} />
                    ))
                  ) : (
                    <div className={styles.noReviews}>
                      {isOwnProfile ? t("noOwnReviews") : t("noPublicReviews")}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Side: Favorite Album Slots */}
              <aside>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 className={styles.sectionTitle} style={{ margin: 0 }}>{t("favoriteAlbums")}</h3>
                  {isOwnProfile && (
                    <button 
                      onClick={() => setIsFavoritesOpen(true)}
                      style={{ 
                        background: "var(--profile-theme-bg, rgba(16, 185, 129, 0.15))", 
                        border: "1px solid var(--profile-theme-border, rgba(16, 185, 129, 0.3))", 
                        color: "var(--profile-theme-color, #10b981)", 
                        cursor: "pointer", 
                        fontSize: "0.75rem", 
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        borderRadius: "12px",
                        transition: "all 0.2s ease"
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = "var(--profile-theme-color, #10b981)";
                        e.currentTarget.style.color = "#08080a";
                        e.currentTarget.style.borderColor = "var(--profile-theme-color, #10b981)";
                        if (!prefersReducedMotion) {
                          e.currentTarget.style.transform = "translateY(-1px)";
                        }
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = "var(--profile-theme-bg, rgba(16, 185, 129, 0.15))";
                        e.currentTarget.style.color = "var(--profile-theme-color, #10b981)";
                        e.currentTarget.style.borderColor = "var(--profile-theme-border, rgba(16, 185, 129, 0.3))";
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path>
                      </svg>
                      {common("edit")}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[1, 2, 3].map((slot) => {
                    const fav = profile.favoriteAlbums?.find(f => f.slot === slot);
                    return (
                      <div key={slot} className={`${styles.favoriteCard} glass`} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)", width: "20px" }}>#{slot}</span>
                        {fav ? (
                          <>
                            <div className={styles.favCoverWrapper} style={{ width: "50px", height: "50px", margin: 0, flexShrink: 0, position: "relative" }}>
                              <Link href={`/albums/${fav.musicItem.id}`}>
                                <img
                                  src={fav.musicItem.coverUrl || "/covers/placeholder.png"}
                                  alt={fav.musicItem.title}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }}
                                />
                              </Link>
                              {isOwnProfile && (
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    try {
                                      const res = await fetch(`/api/users/${username}`, {
                                        method: "PUT",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          favoriteAlbums: [
                                            { slot: fav.slot, musicItemId: null }
                                          ]
                                        })
                                      });
                                      if (res.ok) {
                                         showToast(t("favoriteRemoved"), "success");
                                        await fetchProfileData();
                                      } else {
                                         showToast(t("operationError"), "error");
                                      }
                                    } catch (err) {
                                       showToast(common("connectionError"), "error");
                                    }
                                  }}
                                  className={styles.deleteOverlay}
                                  title={t("removeFavorite")}
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform var(--transition-fast)" }} onMouseOver={(e) => { if (!prefersReducedMotion) e.currentTarget.style.transform = "scale(1.15)"; }} onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}>
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              )}
                            </div>
                            <div style={{ flexGrow: 1, minWidth: 0 }}>
                              <h4 className={styles.favAlbumTitle} style={{ fontSize: "0.85rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                <Link href={`/albums/${fav.musicItem.id}`}>
                                  {fav.musicItem.title}
                                </Link>
                              </h4>
                              <span className={styles.favAlbumArtist} style={{ fontSize: "0.7rem", marginTop: "2px", display: "block" }}>{fav.musicItem.artist}</span>
                            </div>
                          </>
                        ) : isOwnProfile ? (
                          <button
                            onClick={() => setIsFavoritesOpen(true)}
                            style={{
                              flexGrow: 1,
                              height: "50px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              border: "1px dashed var(--theme-border)",
                              borderRadius: "8px",
                              color: "var(--theme-color)",
                              background: "var(--theme-glow)",
                              fontSize: "0.75rem",
                              fontWeight: "600",
                              cursor: "pointer",
                              transition: "all 0.2s ease"
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.borderColor = "var(--theme-color)";
                              if (!prefersReducedMotion) {
                                e.currentTarget.style.transform = "scale(1.02)";
                              }
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.borderColor = "var(--theme-border)";
                              e.currentTarget.style.transform = "scale(1)";
                            }}
                          >
                            <span style={{ fontSize: "1rem", fontWeight: "bold" }}>+</span> {t("addFavorite")}
                          </button>
                        ) : (
                          <div style={{ flexGrow: 1, height: "50px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                             {t("emptyFavoriteSlot")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}

          {activeTab === "lists" && (
            <div style={{ width: "100%" }}>
              {selectedList ? (
                /* Detail list view */
                <div className="card glass" style={{ padding: "24px", marginBottom: "24px" }}>
                  {isEditingList ? (
                    <form onSubmit={handleEditListSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "16px" }}>
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>{t("listTitle")}</label>
                        <input
                          type="text"
                          className={styles.formInput}
                          value={editListTitle}
                          onChange={(e) => setEditListTitle(e.target.value)}
                          required
                          maxLength={100}
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>{t("listDescription")} ({common("optional")})</label>
                        <textarea
                          className={styles.formInput}
                          value={editListDesc}
                          onChange={(e) => setEditListDesc(e.target.value)}
                          rows={3}
                          maxLength={500}
                        />
                      </div>
                      <div className={styles.checkboxGroup}>
                        <input
                          type="checkbox"
                          id="edit-list-public"
                          checked={editListPublic}
                          onChange={(e) => setEditListPublic(e.target.checked)}
                          className={styles.checkbox}
                        />
                        <label htmlFor="edit-list-public" className={styles.checkboxLabel}>{t("publicList")}</label>
                      </div>
                      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                        <Button variant="secondary" onClick={() => setIsEditingList(false)}>{common("cancel")}</Button>
                        <Button type="submit" variant="neon">{t("saveChanges")}</Button>
                      </div>
                    </form>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "16px" }}>
                      <div>
                        <Button variant="secondary" size="compact" onClick={() => setSelectedList(null)} style={{ marginBottom: "12px" }}>
                          ← {t("backToLists")}
                        </Button>
                        <h2 className={styles.listTitle} style={{ fontSize: "2rem" }}>{selectedList.title}</h2>
                        {selectedList.description && (
                          <p style={{ color: "var(--text-secondary)", marginTop: "8px", fontSize: "0.95rem" }}>{selectedList.description}</p>
                        )}
                        <span className={styles.listMeta}>
                          {t("createdBy", { username: selectedList.user.username })} • {t("listSummary", {
                            albums: t("albumsCount", { count: selectedList.items.length }),
                            visibility: selectedList.isPublic ? t("public") : t("private")
                          })}
                        </span>
                      </div>
                      {isOwnProfile && (
                        <div style={{ display: "flex", gap: "10px" }}>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditListTitle(selectedList.title);
                              setEditListDesc(selectedList.description || "");
                              setEditListPublic(selectedList.isPublic);
                              setIsEditingList(true);
                            }}
                          >
                            {t("editList")}
                          </Button>
                          <Button variant="danger" onClick={() => handleDeleteList(selectedList.id)}>
                            {t("deleteList")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add Album Input */}
                  {isOwnProfile && (
                    <div style={{ margin: "24px 0", borderTop: "1px solid var(--border)", paddingTop: "20px" }}>
                      <h4 style={{ color: "var(--text-primary)", marginBottom: "10px", fontSize: "0.95rem" }}>{t("addAlbum")}:</h4>
                      <div className={styles.formGroup} style={{ position: "relative" }}>
                        <input
                          type="text"
                          className={styles.formInput}
                          placeholder={t("searchAlbumPlaceholder")}
                          aria-label={t("searchAlbumPlaceholder")}
                          value={listItemQuery}
                          onChange={(e) => setListItemQuery(e.target.value)}
                        />
                        {listSearching && <div className={styles.searchingText} style={{ position: "absolute", right: "12px", top: "12px" }}>{common("searching")}</div>}
                        
                        {listSearchResults.length > 0 && (
                          <div className={styles.searchResultsDropdown}>
                            {listSearchResults.map((albumItem) => (
                              <div
                                key={albumItem.id}
                                className={styles.searchResultItem}
                                onClick={() => handleAddItemToList(albumItem)}
                                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                              >
                                <img src={albumItem.coverUrl} alt={albumItem.title} style={{ width: "36px", height: "36px", borderRadius: "4px" }} />
                                <div>
                                  <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.85rem" }}>{albumItem.title}</div>
                                  <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>{albumItem.artist}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* List Items Grid */}
                  <div className={styles.listsGrid} style={{ marginTop: "20px" }}>
                    {selectedList.items.length > 0 ? (
                      selectedList.items.map((item: any) => (
                        <div key={item.id} className="card glass" style={{ padding: "16px", display: "flex", gap: "12px", alignItems: "center", position: "relative" }}>
                          <img src={item.musicItem.coverUrl} alt={item.musicItem.title} style={{ width: "60px", height: "60px", borderRadius: "6px", objectFit: "cover" }} />
                          <div style={{ flexGrow: 1 }}>
                            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
                              <Link href={`/albums/${item.musicItem.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                                {item.musicItem.title}
                              </Link>
                            </h4>
                            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{item.musicItem.artist}</p>
                          </div>
                          {isOwnProfile && (
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => handleRemoveItemFromList(item.musicItemId)}
                              aria-label={t("removeFromList")}
                            >
                              <span aria-hidden="true">&times;</span>
                            </Button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p style={{ color: "var(--text-muted)", gridColumn: "1/-1", textAlign: "center", padding: "20px" }}>{t("emptyList")}</p>
                    )}
                  </div>
                </div>
              ) : (
                /* Grid view of user's lists */
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                    <h3 className={styles.sectionTitle}>{t("listCollections")}</h3>
                    {isOwnProfile && (
                      <Button variant="neon" onClick={() => setIsCreateListOpen(true)}>
                        {t("createNewList")}
                      </Button>
                    )}
                  </div>

                  {lists.length > 0 ? (
                    <div className={styles.listsGrid}>
                      {lists.map((list) => (
                        <div
                          key={list.id}
                          onClick={() => handleSelectList(list.id)}
                          className={`${styles.listCard} card glass`}
                          style={{ cursor: "pointer" }}
                        >
                          <div>
                            <h4 className={styles.listTitle}>{list.title}</h4>
                            <p className={styles.listMeta} style={{ marginTop: "4px" }}>
                              {t("listSummary", {
                                albums: t("albumsCount", { count: list.items?.length || 0 }),
                                visibility: list.isPublic ? t("public") : t("private")
                              })}
                            </p>
                          </div>
                          <div className={styles.coversStack}>
                            {list.items && list.items.length > 0 ? (
                              list.items.map((item: any, idx: number) => (
                                <img
                                  key={idx}
                                  src={item.musicItem.coverUrl}
                                  alt={item.musicItem.title}
                                  className={styles.stackCover}
                                  style={{ transform: `translateX(-${idx * 10}px)` }}
                                />
                              ))
                            ) : (
                              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t("emptyList")}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.noReviews} style={{ textAlign: "center", padding: "40px" }}>
                      {t("noLists")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "diary" && (
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 className={styles.sectionTitle}>{t("diary")}</h3>
                {isOwnProfile && (
                  <Button variant="neon" onClick={() => setIsDiaryModalOpen(true)}>
                    {t("diaryTitle")}
                  </Button>
                )}
              </div>

              {diaryLogs.length > 0 ? (
                <div className={styles.diaryTimeline}>
                  {diaryLogs.map((log) => {
                    const formattedLogDate = new Date(log.listenedAt).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    });
                    return (
                      <div key={log.id} className={`${styles.diaryRow} card glass`}>
                        <div className={styles.diaryInfo}>
                          <img src={log.musicItem.coverUrl} alt={log.musicItem.title} className={styles.diaryCover} />
                          <div className={styles.diaryTextInfo}>
                            <Link href={`/albums/${log.musicItem.id}`} className={styles.diaryAlbumLink}>
                              {log.musicItem.title}
                            </Link>
                            <span className={styles.diaryArtist}>{log.musicItem.artist}</span>
                            {log.notes && (
                              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "4px", fontStyle: "italic" }}>
                                &ldquo;{log.notes}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                        <div className={styles.diaryMeta}>
                          {log.ratingValue && (
                            <RatingStars value={log.ratingValue} size={12} />
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {log.listenCount > 1 && (
                              <span className={styles.listenCountBadge} title={t("listenCount", { count: log.listenCount })}>
                                🎧 ×{log.listenCount}
                              </span>
                            )}
                            <span className={styles.diaryDate}>{formattedLogDate}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.noReviews} style={{ textAlign: "center", padding: "40px" }}>
                  {t("noDiary")}
                </div>
              )}
            </div>
          )}

          {activeTab === "stats" && (
            <div style={{ width: "100%" }}>
              <h3 className={styles.sectionTitle} style={{ marginBottom: "20px" }}>{t("statistics")}</h3>
              
              {statsData ? (
                <div className={styles.statsDashboard}>
                  {/* Rating Distribution Histogram */}
                  <div className={`${styles.chartCard} card glass`}>
                    <h4 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>{t("scoreDistribution")}</h4>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      {t("average", { value: statsData.averageRating.toFixed(2) })} ★ ({t("ratingsCount", { count: statsData.totalRatings })})
                    </span>
                    <span style={{ display: "block", marginTop: "6px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      {t("diaryStatsSummary", {
                        listens: statsData.totalListens ?? 0,
                        unique: statsData.uniqueListenedItems ?? 0,
                      })}
                    </span>
                    
                    <div className={styles.distributionChart}>
                      {Object.entries(statsData.ratingDistribution)
                        .reverse()
                        .map(([rating, count]) => {
                          const maxCount = Math.max(...Object.values(statsData.ratingDistribution) as number[]) || 1;
                          const pct = ((count as number) / maxCount) * 100;
                          return (
                            <div key={rating} className={styles.barRow}>
                              <span className={styles.ratingLabel}>{parseFloat(rating).toFixed(1)} ★</span>
                              <div className={styles.barWrapper}>
                                <div className={styles.barFill} style={{ transform: `scaleX(${pct / 100})` }} />
                              </div>
                              <span className={styles.barCount}>{count as number}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Top Artists list */}
                  <div className={`${styles.artistsCard} card glass`}>
                    <h4 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>{t("topArtists")}</h4>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{t("topArtistsSubtitle")}</span>
                    
                    <div className={styles.artistList}>
                      {statsData.topArtists.length > 0 ? (
                        statsData.topArtists.map((artist: any, idx: number) => (
                          <div key={idx} className={styles.artistRow}>
                            <span className={styles.artistName}>{idx + 1}. {artist.name}</span>
                            <span className={styles.artistReviewsCount}>
                              {t("reviewsCount", { count: artist.count })}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "20px" }}>{t("noData")}</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "20px" }}>{t("noStatistics")}</div>
              )}
            </div>
          )}

          {activeTab === "listen-later" && (
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 className={styles.sectionTitle}>{t("listenLater")}</h3>
              </div>

              {listenLaterItems.length > 0 ? (
                <div className={styles.listsGrid}>
                  {listenLaterItems.map((item) => (
                    <div 
                      key={item.musicItemId}
                      className="card glass" 
                      style={{ 
                        padding: "16px", 
                        display: "flex", 
                        gap: "12px", 
                        alignItems: "center", 
                        position: "relative" 
                      }}
                    >
                      <img 
                        src={item.musicItem.coverUrl} 
                        alt={item.musicItem.title} 
                        style={{ width: "60px", height: "60px", borderRadius: "6px", objectFit: "cover" }} 
                      />
                      <div style={{ flexGrow: 1, minWidth: 0 }}>
                        <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Link href={`/albums/${item.musicItem.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {item.musicItem.title}
                          </Link>
                        </h4>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.musicItem.artist}
                        </p>
                      </div>
                      {isOwnProfile && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleRemoveFromListenLater(item.musicItemId)}
                          aria-label={t("removeListenLater")}
                        >
                          <span aria-hidden="true">&times;</span>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.noReviews} style={{ textAlign: "center", padding: "40px" }}>
                  {t("listenLaterEmpty")}
                </div>
              )}
            </div>
          )}
        </>
      )}
      </section>
      </div>

      {/* Edit Profile Modal */}
      {profile && (
        <EditProfileModal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          profile={profile}
          onSave={fetchProfileData}
        />
      )}

      {/* Edit Favorites Modal */}
      {profile && (
        <EditFavoritesModal
          isOpen={isFavoritesOpen}
          onClose={() => setIsFavoritesOpen(false)}
          profile={profile}
          onSave={fetchProfileData}
        />
      )}

      <CreateListDialog
        isOpen={isCreateListOpen}
        onClose={() => setIsCreateListOpen(false)}
        onSubmit={handleCreateList}
        title={newListTitle}
        onTitleChange={setNewListTitle}
        description={newListDesc}
        onDescriptionChange={setNewListDesc}
        isPublic={newListPublic}
        onPublicChange={setNewListPublic}
      />

      <DiaryDialog
        isOpen={isDiaryModalOpen}
        onClose={() => setIsDiaryModalOpen(false)}
        onSubmit={handleCreateDiaryLog}
        selectedAlbum={diarySelectedAlbum}
        onSelectedAlbumChange={setDiarySelectedAlbum}
        searchQuery={diarySearchQuery}
        onSearchQueryChange={setDiarySearchQuery}
        searchResults={diarySearchResults}
        searching={diarySearching}
        rating={diaryRating}
        onRatingChange={setDiaryRating}
        notes={diaryNotes}
        onNotesChange={setDiaryNotes}
      />

      <DeleteListDialog
        listId={listToDelete}
        onClose={() => setListToDelete(null)}
        onConfirm={(listId) => {
          executeDeleteList(listId);
          setListToDelete(null);
        }}
      />

      {/* Account Settings Modal */}
      {isAccountSettingsOpen && (
        <AccountSettingsModal
          isOpen={isAccountSettingsOpen}
          onClose={() => setIsAccountSettingsOpen(false)}
          username={profile.username}
        />
      )}

      {/* Recap Modal */}
      {isRecapOpen && (
        <RecapModal
          username={profile.username}
          onClose={() => setIsRecapOpen(false)}
        />
      )}
    </div>
  );
}
