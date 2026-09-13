import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function selectLatestRelease(releases) {
  return releases
    .filter((release) => !release.draft && release.published_at)
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))[0]
}

export function selectDmg(assets = []) {
  return assets.find((asset) => asset.name.toLowerCase().endsWith('.dmg'))
}

export async function fetchReleases(fetchImpl, repository, token) {
  const headers = {
    Accept: 'application/vnd.github.html+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/releases?per_page=30`,
    { headers },
  )
  if (!response.ok) {
    throw new Error(`GitHub Releases request failed (${response.status})`)
  }
  return response.json()
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

function versionOf(release) {
  return release.tag_name.replace(/^v/, '')
}

function releaseNotes(release) {
  return release.body_html || '<p>Maintenance improvements and fixes.</p>'
}

function olderRelease(release) {
  return `
    <details class="release">
      <summary>
        <span>${escapeHtml(release.name || `Slug ${versionOf(release)}`)}</span>
        <time datetime="${escapeHtml(release.published_at)}">${formatDate(release.published_at)}</time>
      </summary>
      <div class="release-notes">${releaseNotes(release)}</div>
      <a class="release-link" href="${escapeHtml(release.html_url)}">View release on GitHub</a>
    </details>`
}

export function buildPage(releases) {
  const published = releases
    .filter((release) => !release.draft && release.published_at)
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
  const latest = selectLatestRelease(published)
  if (!latest) throw new Error('No published Slug release was found')
  const dmg = selectDmg(latest.assets)
  if (!dmg) throw new Error(`${latest.tag_name} has no DMG installer`)

  const version = versionOf(latest)
  const previous = published.slice(1, 7).map(olderRelease).join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#F8F2E1">
    <meta name="description" content="Slug is a focused Markdown editor for macOS with live preview, project files, and agent-ready terminal sessions.">
    <meta property="og:title" content="Slug for macOS">
    <meta property="og:description" content="Write, preview, and work with agents without leaving your document.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://kyle-marks.github.io/slug-beta/">
    <title>Slug — Markdown editor for macOS</title>
    <link rel="canonical" href="https://kyle-marks.github.io/slug-beta/">
    <link rel="icon" href="assets/slug-icon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="assets/styles.css">
  </head>
  <body>
    <header class="site-header wrap">
      <a class="brand" href="./" aria-label="Slug home">
        <img src="assets/slug-icon.svg" alt="" width="42" height="42">
        <span>Slug</span>
      </a>
      <nav aria-label="Main navigation">
        <a href="#whats-new">What’s new</a>
        <a href="https://github.com/kyle-marks/slug-beta/releases">All releases</a>
      </nav>
    </header>

    <main>
      <section class="hero wrap">
        <div class="hero-copy">
          <p class="status">Beta for macOS</p>
          <h1>Your Markdown workspace, with the terminal built in.</h1>
          <p class="summary">Slug brings live Markdown preview, project files, and agent-ready terminal sessions into one focused window.</p>
          <div class="actions">
            <a class="download" href="${escapeHtml(dmg.browser_download_url)}">Download Slug ${escapeHtml(version)}</a>
            <a class="secondary" href="#whats-new">See what’s new</a>
          </div>
          <p class="download-meta">macOS 15 or later <span aria-hidden="true">·</span> Apple silicon + Intel <span aria-hidden="true">·</span> ${formatMegabytes(dmg.size)}</p>
          <p class="trust">Signed, notarized, and ready to try.</p>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <img src="assets/slug-icon.svg" alt="" width="360" height="360">
        </div>
      </section>

      <section class="latest wrap" id="whats-new">
        <div class="section-heading">
          <div>
            <p class="status">Latest update</p>
            <h2>What’s new in Slug ${escapeHtml(version)}</h2>
          </div>
          <time datetime="${escapeHtml(latest.published_at)}">${formatDate(latest.published_at)}</time>
        </div>
        <div class="release-notes latest-notes">${releaseNotes(latest)}</div>
      </section>

      <section class="history wrap" aria-labelledby="history-title">
        <div class="section-heading">
          <h2 id="history-title">Previous updates</h2>
          <a href="https://github.com/kyle-marks/slug-beta/releases">View all</a>
        </div>
        <div class="release-list">${previous}</div>
      </section>

      <section class="install wrap">
        <img src="assets/slug-icon.svg" alt="" width="72" height="72">
        <div>
          <h2>Install in a minute</h2>
          <p>Open the downloaded DMG, drag Slug into Applications, and launch it. Already using Slug? Choose <strong>Slug → Check for Updates…</strong></p>
        </div>
      </section>
    </main>

    <footer class="wrap">
      <span>Slug is currently in beta.</span>
      <a href="https://github.com/kyle-marks/slug-beta/releases">Release archive</a>
    </footer>
  </body>
</html>`
}

export async function writeSite({ releases, outputDir, staticDir, appcastPath }) {
  await mkdir(join(outputDir, 'assets'), { recursive: true })
  await Promise.all([
    writeFile(join(outputDir, 'index.html'), buildPage(releases)),
    copyFile(join(staticDir, 'assets', 'styles.css'), join(outputDir, 'assets', 'styles.css')),
    copyFile(join(staticDir, 'assets', 'slug-icon.svg'), join(outputDir, 'assets', 'slug-icon.svg')),
    copyFile(appcastPath, join(outputDir, 'appcast.xml')),
  ])
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const root = dirname(scriptDir)
  const releases = await fetchReleases(
    fetch,
    process.env.GITHUB_REPOSITORY || 'kyle-marks/slug-beta',
    process.env.GITHUB_TOKEN,
  )
  await writeSite({
    releases,
    outputDir: join(root, '_site'),
    staticDir: join(root, 'site'),
    appcastPath: join(root, 'appcast.xml'),
  })
  console.log(`Built Slug ${versionOf(selectLatestRelease(releases))} download page in _site/`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
