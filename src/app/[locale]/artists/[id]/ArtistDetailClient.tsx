"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations, useLocale } from "next-intl";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import styles from "./page.module.css";
import Cover3D from "@/components/Cover3D/Cover3D";
import { getUniqueArtistReleases } from "@/utils/artist-discography";

interface ArtistData {
  artist: {
    id: string;
    name: string;
    pictureUrl: string;
    pictureXlUrl: string;
    nb_fan: number;
    nb_album: number;
  };
  topTracks: Array<{
    id: string;
    title: string;
    duration: string;
    album: { id: string; title: string };
  }>;
  albums: Array<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    releaseYear: number;
  }>;
  nextAlbumOffset: number | null;
  related: Array<{
    id: string;
    name: string;
    pictureUrl: string;
  }>;
}

export default function ArtistDetailClient({
  id,
  initialData,
}: {
  id: string;
  initialData: ArtistData | null;
}) {
  const t = useTranslations("Artist");
  const locale = useLocale();
  const [data, setData] = useState<ArtistData | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [initialError, setInitialError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [albums, setAlbums] = useState(initialData?.albums ?? []);
  const [nextAlbumOffset, setNextAlbumOffset] = useState(initialData?.nextAlbumOffset ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState("");
  const loadMoreInFlight = useRef(false);
  const discographyRef = useRef<HTMLDivElement>(null);
  const [hasDiscographyEntered, setHasDiscographyEntered] = useState(false);

  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      setHasDiscographyEntered(true);
      return;
    }

    const target = discographyRef.current;
    if (!target || hasDiscographyEntered) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setHasDiscographyEntered(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });

    observer.observe(target);
    return () => observer.disconnect();
  }, [albums.length, hasDiscographyEntered, prefersReducedMotion]);

  useEffect(() => {
    setData(initialData);
    setAlbums(initialData?.albums ?? []);
    setNextAlbumOffset(initialData?.nextAlbumOffset ?? null);
    setInitialError(false);
    setLoadMoreError(false);
    setReleaseStatus("");

    if (initialData) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchArtist = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/artists/${encodeURIComponent(id)}`);
        if (res.status === 404) return;
        if (!res.ok) throw new Error("Failed to fetch artist data");

        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setAlbums(json.albums);
          setNextAlbumOffset(json.nextAlbumOffset);
        }
      } catch (error) {
        console.error("Failed to fetch artist data", error);
        if (!cancelled) setInitialError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchArtist();
    return () => {
      cancelled = true;
    };
  }, [id, initialData, retryCount]);

  const loadMoreAlbums = async () => {
    const artistId = data?.artist.id;
    if (artistId === undefined || nextAlbumOffset === null || loadMoreInFlight.current) return;

    loadMoreInFlight.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    setReleaseStatus("");

    try {
      const res = await fetch(
        `/api/artists/${encodeURIComponent(artistId)}?albumsOffset=${nextAlbumOffset}`
      );
      if (!res.ok) throw new Error("Failed to load more albums");

      const page: Pick<ArtistData, "albums" | "nextAlbumOffset"> = await res.json();
      const newAlbums = getUniqueArtistReleases(albums, page.albums);

      setAlbums((currentAlbums) => [...currentAlbums, ...newAlbums]);
      setNextAlbumOffset(page.nextAlbumOffset);
      if (newAlbums.length > 0) {
        setReleaseStatus(t("releasesLoaded", { count: newAlbums.length }));
      }
    } catch (error) {
      console.error("Failed to load more artist albums", error);
      setLoadMoreError(true);
    } finally {
      loadMoreInFlight.current = false;
      setIsLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container} role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className={`${styles.hero} ${styles.heroSkeleton}`} aria-hidden="true">
          <div className={styles.heroContent}>
            <span className="skeleton" style={{ width: "min(480px, 80%)", height: 64, marginBottom: 16 }} />
            <span className="skeleton" style={{ width: 140, height: 16 }} />
          </div>
        </div>
        <div className={styles.contentContainer} aria-hidden="true">
          <div className={styles.contentInner}>
            <div className={styles.albumsGrid}>
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className={styles.albumCard}>
                  <span className="skeleton" style={{ width: "100%", aspectRatio: "1", borderRadius: 12 }} />
                  <span className="skeleton" style={{ width: "70%", height: 14 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (initialError) {
    return (
      <div className={styles.container}>
        <div className={styles.initialError} role="alert">
          <p>{t("discographyLoadError")}</p>
          <button type="button" className={styles.loadMoreButton} onClick={() => setRetryCount((count) => count + 1)}>
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.initialError} role="alert">
          <p>{t("notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>

      <div className={styles.hero}>
        {prefersReducedMotion ? (
          <div className={styles.heroBackground}>
            <img
              src={data.artist.pictureXlUrl}
              alt={data.artist.name}
              className={styles.heroImage}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          <AnimatedArtistHeroBackground src={data.artist.pictureXlUrl} alt={data.artist.name} />
        )}
        <div className={styles.heroOverlay} />
        
        {prefersReducedMotion ? (
          <div className={styles.heroContent}>
            <h1 className={styles.artistName}>{data.artist.name}</h1>
            <div className={styles.artistStats}>
              <span className={styles.fansCount}>
                {new Intl.NumberFormat(locale).format(data.artist.nb_fan)}
              </span>{" "}
              {t("fans")}
            </div>
          </div>
        ) : (
          <AnimatedArtistHeroContent
            locale={locale}
            name={data.artist.name}
            fans={data.artist.nb_fan}
            label={t("fans")}
          />
        )}
      </div>

      <div className={styles.contentContainer}>
        <div className={styles.contentInner}>
          
          <div className={styles.topSectionGrid}>
            <div>
              <h2 className={styles.sectionTitle}>{t("topTracks")}</h2>
              <div className={styles.trackList}>
                {data.topTracks.map((track, i) => (
                  <div key={track.id} className={styles.trackItem}>
                    <span className={styles.trackNumber}>{i + 1}</span>
                    <div className={styles.trackInfo}>
                      <span className={styles.trackTitle}>{track.title}</span>
                      <span className={styles.trackAlbum}>{track.album.title}</span>
                    </div>
                    <span className={styles.trackDuration}>{track.duration}</span>
                  </div>
                ))}
                {data.topTracks.length === 0 && (
                  <p className={styles.emptyDiscography}>{t("noTopTracks")}</p>
                )}
              </div>
            </div>

            <div>
              <h2 className={styles.sectionTitle}>{t("relatedArtists")}</h2>
              <div className={styles.relatedGrid}>
                {data.related.map((artist) => (
                  <Link href={`/artists/${artist.id}`} key={artist.id} className={styles.relatedCard}>
                    <div className={styles.relatedImageContainer}>
                      <img
                        src={artist.pictureUrl}
                        alt=""
                        loading="lazy"
                        className={styles.relatedImage}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                    <span className={styles.relatedName}>{artist.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <section className={styles.discographySection} aria-labelledby="artist-discography-title">
            <h2 id="artist-discography-title" className={styles.sectionTitle}>{t("discography")}</h2>
            {albums.length > 0 ? (
              <>
                <div
                  ref={discographyRef}
                  className={`${styles.albumsGrid} ${hasDiscographyEntered ? styles.albumsGridEntered : ""}`}
                >
                  {albums.map((album) => (
                    <article key={album.id} className={styles.albumCard}>
                      <div className={styles.albumCover}>
                        <Link href={`/albums/${album.id}`} className={styles.albumCoverLink}>
                          <Cover3D src={album.coverUrl} alt={album.title} size="100%" />
                        </Link>
                      </div>
                      <div className={styles.albumMeta}>
                        <Link href={`/albums/${album.id}`} className={styles.albumTitle}>
                          {album.title}
                        </Link>
                        <span className={styles.albumYear}>{album.releaseYear}</span>
                      </div>
                    </article>
                  ))}
                </div>

                <div className={styles.discographyActions}>
                  {nextAlbumOffset !== null && (
                    <button
                      type="button"
                      className={styles.loadMoreButton}
                      onClick={loadMoreAlbums}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? t("loadingMore") : t("loadMore")}
                    </button>
                  )}
                  {loadMoreError && (
                    <div className={styles.loadMoreError} role="alert">
                      <span>{t("loadMoreError")}</span>
                      <button type="button" className={styles.retryButton} onClick={loadMoreAlbums}>
                        {t("retry")}
                      </button>
                    </div>
                  )}
                  <p className={styles.statusMessage} role="status" aria-live="polite">
                    {releaseStatus}
                  </p>
                </div>
              </>
            ) : (
              <p className={styles.emptyDiscography}>{t("noDiscography")}</p>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

function AnimatedArtistHeroBackground({ src, alt }: { src: string; alt: string }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 200]);

  return (
    <motion.div className={styles.heroBackground} style={{ y }}>
      <img src={src} alt={alt} className={styles.heroImage} style={{ width: "100%", height: "100%" }} />
    </motion.div>
  );
}

function AnimatedArtistHeroContent({ locale, name, fans, label }: { locale: string; name: string; fans: number; label: string }) {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const scale = useTransform(scrollY, [0, 300], [1, 0.95]);

  return (
    <motion.div className={styles.heroContent} style={{ opacity, scale }}>
      <h1 className={styles.artistName}>{name}</h1>
      <div className={styles.artistStats}>
        <span className={styles.fansCount}>{new Intl.NumberFormat(locale).format(fans)}</span>{" "}{label}
      </div>
    </motion.div>
  );
}
