"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/routing";
import Avatar from "@/components/Avatar/Avatar";
import styles from "./page.module.css";
import { useTranslations, useLocale } from "next-intl";

interface ListData {
  id: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  user: {
    username: string;
    profileColor: string | null;
    profileImage?: string | null;
  };
  items: Array<{
    id: string;
    order: number;
    musicItemId: string;
    musicItem: {
      id: string;
      title: string;
      artist: string;
      coverUrl: string;
    };
  }>;
}

export default function ListDetailClient({ id }: { id: string }) {
  const [list, setList] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("List");
  const common = useTranslations("Common");
  const locale = useLocale();

  useEffect(() => {
    async function fetchList() {
      try {
        const res = await fetch(`/api/lists/${id}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            throw new Error(t("private"));
          }
          throw new Error(t("notFound"));
        }
        const data = await res.json();
        setList(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchList();
  }, [id, t]);

  if (loading) {
    return (
      <div className={styles.container} role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className={styles.header} aria-hidden="true">
          <span className="skeleton" style={{ width: "min(320px, 70%)", height: 44, marginBottom: 16 }} />
          <span className="skeleton" style={{ width: 240, height: 14 }} />
        </div>
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={styles.card}>
              <span className={`skeleton ${styles.coverWrapper}`} />
              <span className="skeleton" style={{ width: "75%", height: 14 }} />
              <span className="skeleton" style={{ width: "45%", height: 12 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <h3>{t("notFound")}</h3>
          <p>{error || t("notFound")}</p>
          <Link href="/explore" className="neon-btn" style={{ marginTop: "20px", display: "inline-flex", alignItems: "center" }}>
            {common("backToExplore")}
          </Link>
        </div>
      </div>
    );
  }

  // Sort items by order (if not already sorted by DB)
  const sortedItems = [...list.items].sort((a, b) => a.order - b.order);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{list.title}</h1>
        {list.description && <p className={styles.description}>{list.description}</p>}
        
        <div className={styles.meta}>
          <span>{t("by")}</span>
          <Link href={`/users/${list.user.username}`} className={styles.author}>
            <Avatar
              username={list.user.username}
              profileColor={list.user.profileColor}
              profileImage={list.user.profileImage}
              size={24}
            />
            @{list.user.username}
          </Link>
          <span aria-hidden="true">•</span>
          <span>{t("albums", {count: list.items.length})}</span>
          <span aria-hidden="true">•</span>
          <span>{new Date(list.createdAt).toLocaleDateString(locale)}</span>
        </div>
      </div>

      {sortedItems.length > 0 ? (
        <div className={styles.grid}>
          {sortedItems.map((item, index) => (
            <Link key={item.id} href={`/albums/${item.musicItemId}`} className={styles.card}>
              <div className={styles.coverWrapper}>
                <div className={styles.orderBadge}>{index + 1}</div>
                <img
                  src={item.musicItem.coverUrl}
                  alt={item.musicItem.title}
                  className={styles.cover}
                  loading="lazy"
                />
              </div>
              <div className={styles.info}>
                <h3 className={styles.titleWrapper} title={item.musicItem.title}>
                  {item.musicItem.title}
                </h3>
                <p className={styles.artist} title={item.musicItem.artist}>
                  {item.musicItem.artist}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p>{t("empty")}</p>
        </div>
      )}
    </div>
  );
}
