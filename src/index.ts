import type { ImageLoader } from 'next/image'

/**
 * Configuration for a shared imgproxy instance.
 *
 * Both `endpoint` and `bucket` fall back to the `NEXT_PUBLIC_IMGPROXY_URL` and
 * `NEXT_PUBLIC_IMGPROXY_BUCKET` environment variables, so a project can either
 * configure once via env or pass values explicitly.
 */
export interface ImgproxyConfig {
  /** imgproxy base URL, e.g. `https://imgproxy.example.com`. */
  endpoint?: string
  /** Source prefix imgproxy reads from, e.g. `s3://my-bucket`. */
  bucket?: string
  /** Default output quality (1–100). Defaults to 80. */
  quality?: number
}

export interface Imgproxy {
  /**
   * next/image loader. Pass as `loader={imgproxy.loader}` and set `src` to the
   * S3 key (Payload's `filename`). next/image builds a responsive srcSet from it.
   */
  loader: ImageLoader
  /** Build an imgproxy URL from an S3 key directly (single size). */
  url: (key: string, opts: { width: number; quality?: number }) => string
  /**
   * Build a ready-to-use URL for raw `<img>` / `<canvas>` / WebGL usages that
   * only have a Payload media URL and cannot take a loader function. Raster →
   * a single-size imgproxy URL; SVG → the same-origin relative media path
   * (vectors have nothing to optimize and imgproxy would only add a hop).
   */
  urlFromMediaUrl: (
    url: string | null | undefined,
    opts: { width: number; quality?: number },
  ) => string
}

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const resolveConfig = (config?: ImgproxyConfig) => {
  const endpoint = stripTrailingSlash(
    (config?.endpoint ?? process.env.NEXT_PUBLIC_IMGPROXY_URL ?? '').trim(),
  )
  const bucket = stripTrailingSlash(
    (config?.bucket ?? process.env.NEXT_PUBLIC_IMGPROXY_BUCKET ?? '').trim(),
  )

  if (!endpoint || !bucket) {
    throw new Error(
      '[next-imgproxy] Missing endpoint/bucket. Pass them to createImgproxy({ endpoint, bucket }) ' +
        'or set NEXT_PUBLIC_IMGPROXY_URL and NEXT_PUBLIC_IMGPROXY_BUCKET.',
    )
  }

  return { endpoint, bucket, quality: config?.quality ?? 80 }
}

const sameOriginPath = (url: string): string => {
  try {
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url)
      return `${parsed.pathname}${parsed.search}`
    }
  } catch {
    /* fall through to the raw url */
  }
  return url
}

/**
 * Extract the decoded S3 key (Payload `filename`) from a media URL such as
 * `/api/media/file/<key>?<tag>` or an absolute variant. Pure and config-free.
 */
export const mediaKeyFromUrl = (url?: string | null): string => {
  if (!url) return ''
  let path = url
  try {
    if (/^https?:\/\//i.test(url)) path = new URL(url).pathname
  } catch {
    /* fall back to the raw string */
  }
  path = path.split('?')[0] ?? ''
  const marker = '/api/media/file/'
  const idx = path.indexOf(marker)
  const seg = idx >= 0 ? path.slice(idx + marker.length) : (path.split('/').pop() ?? '')
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/**
 * Create a configured imgproxy helper set. imgproxy reads the original directly
 * from S3 and encodes on-the-fly with libvips, auto-negotiating AVIF/WebP via
 * the browser's `Accept` header — so no sharp/optimizer work runs on the app
 * server. Note: no `f:auto` in the URL — format is chosen automatically by
 * imgproxy's WebP/AVIF detection (enabled on the imgproxy container).
 */
export const createImgproxy = (config?: ImgproxyConfig): Imgproxy => {
  const { endpoint, bucket, quality: defaultQuality } = resolveConfig(config)

  const url: Imgproxy['url'] = (key, opts) => {
    // Single flat S3 key (no sub-paths), so encoding the whole segment keeps
    // `<bucket>/` literal while escaping spaces etc. in the filename.
    const encoded = encodeURIComponent(key.replace(/^\/+/, ''))
    const quality = opts.quality ?? defaultQuality
    return `${endpoint}/insecure/rs:fit:${opts.width}/q:${quality}/plain/${bucket}/${encoded}`
  }

  const loader: ImageLoader = ({ src, width, quality }) =>
    url(src, { width, quality: quality ?? undefined })

  const urlFromMediaUrl: Imgproxy['urlFromMediaUrl'] = (mediaUrl, opts) => {
    if (!mediaUrl) return ''
    const key = mediaKeyFromUrl(mediaUrl)
    if (!key) return ''
    if (key.toLowerCase().endsWith('.svg')) return sameOriginPath(mediaUrl)
    return url(key, opts)
  }

  return { loader, url, urlFromMediaUrl }
}

/** Convenience: just the next/image loader. Equivalent to `createImgproxy(config).loader`. */
export const createImgproxyLoader = (config?: ImgproxyConfig): ImageLoader =>
  createImgproxy(config).loader
