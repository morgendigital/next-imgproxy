# @morgendigital/next-imgproxy

A `next/image` loader plus small helpers that route images through a shared
[imgproxy](https://imgproxy.net) instance instead of the on-server
`/_next/image` optimizer.

imgproxy reads the original directly from S3 and encodes on-the-fly with libvips
(fast, low memory), auto-negotiating **AVIF/WebP** via the browser's `Accept`
header. No `sharp` runs on the app server — which is what removes the per-request
optimizer work that can OOM a self-hosted Next container under load.

## Install

Published to GitHub Packages. Add an `.npmrc` to the consuming project:

```
@morgendigital:registry=https://npm.pkg.github.com
```

```bash
pnpm add @morgendigital/next-imgproxy
# peer dependency: next >= 14
```

## Configure

Set once per project (env), or pass explicitly to `createImgproxy`:

```
NEXT_PUBLIC_IMGPROXY_URL=https://imgproxy.example.com
NEXT_PUBLIC_IMGPROXY_BUCKET=s3://my-bucket
```

## Usage

Create one configured instance and reuse it:

```ts
// src/utilities/imgproxy.ts
import { createImgproxy } from '@morgendigital/next-imgproxy'

const imgproxy = createImgproxy() // reads NEXT_PUBLIC_IMGPROXY_URL / _BUCKET
export const imgproxyLoader = imgproxy.loader
export const imgproxyUrlFromMediaUrl = imgproxy.urlFromMediaUrl
export { mediaKeyFromUrl } from '@morgendigital/next-imgproxy'
```

### 1. `next/image` (responsive srcSet)

Pass the loader and set `src` to the **S3 key** (Payload's `filename`):

```tsx
import Image from 'next/image'
import { imgproxyLoader, mediaKeyFromUrl } from '@/utilities/imgproxy'

<Image
  loader={imgproxyLoader}
  src={resource.filename ?? mediaKeyFromUrl(resource.url)}
  width={resource.width}
  height={resource.height}
  alt={resource.alt ?? ''}
/>
```

> A custom loader must be passed from a **Client Component** — a loader function
> cannot cross the Server→Client boundary. In a Server Component, build the URL
> string instead (see below) and mark the image `unoptimized`.

### 2. Raw `<img>` / `<canvas>` / WebGL / Server Components

These take a plain URL string. Raster → a single-size imgproxy URL; SVG → the
same-origin relative path (nothing to optimize):

```tsx
// WebGL texture, motion.img, etc.
<img src={imgproxyUrlFromMediaUrl(resource.url, { width: 1600 })} />

// Server Component <Image>: build the URL and mark unoptimized
<Image
  src={imgproxyUrlFromMediaUrl(resource.url, { width: 2000 }) /* or imgproxy.url(key, {width}) */}
  unoptimized
  width={2000}
  height={1000}
  alt=""
/>
```

## API

- `createImgproxy(config?)` → `{ loader, url, urlFromMediaUrl }`
- `createImgproxyLoader(config?)` → `ImageLoader` (just the loader)
- `mediaKeyFromUrl(url)` → decoded S3 key from a `/api/media/file/<key>` URL (pure)

`config`: `{ endpoint?, bucket?, quality? }` — endpoint/bucket fall back to
`NEXT_PUBLIC_IMGPROXY_URL` / `NEXT_PUBLIC_IMGPROXY_BUCKET`; `quality` defaults to 80.

## Notes

- **No `f:auto`** in the produced URLs — that is not a valid imgproxy option.
  Format is negotiated automatically by imgproxy's WebP/AVIF detection, which must
  be enabled on the imgproxy container (`IMGPROXY_ENABLE_WEBP_DETECTION`,
  `IMGPROXY_ENABLE_AVIF_DETECTION`).
- Unsigned URLs (`/insecure/`). Restrict abuse at the imgproxy/CDN layer
  (`IMGPROXY_ALLOWED_SOURCES=s3://`, rate limiting). Signed URLs would require
  server-side signing and are out of scope for a client-side loader.

## Develop

```bash
npm install
npm run build      # tsup -> dist (ESM + CJS + d.ts)
npm run typecheck
```
