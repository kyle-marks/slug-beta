import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('selectLatestRelease includes prereleases and ignores drafts', async () => {
  const site = await import('../scripts/build-site.mjs').catch(() => ({}))

  const releases = [
    { tag_name: 'v2.0.0', published_at: '2026-09-14T12:00:00Z', draft: true },
    { tag_name: 'v1.9.0', published_at: '2026-09-12T12:00:00Z', draft: false },
    {
      tag_name: 'v1.10.0',
      published_at: '2026-09-13T12:00:00Z',
      draft: false,
      prerelease: true,
    },
  ]

  assert.equal(site.selectLatestRelease?.(releases)?.tag_name, 'v1.10.0')
})

test('selectDmg chooses the installer instead of its blockmap', async () => {
  const site = await import('../scripts/build-site.mjs')
  const assets = [
    {
      name: 'Slug-1.10.0-universal.dmg.blockmap',
      browser_download_url: 'https://example.com/update-map',
    },
    {
      name: 'Slug-1.10.0-universal.dmg',
      browser_download_url: 'https://example.com/slug.dmg',
      size: 237_000_000,
    },
  ]

  assert.deepEqual(site.selectDmg?.(assets), assets[1])
})

test('buildPage makes the newest DMG the primary action and renders release notes', async () => {
  const site = await import('../scripts/build-site.mjs')
  const releases = [
    {
      tag_name: 'v1.10.0',
      name: 'Slug 1.10.0',
      published_at: '2026-09-13T12:00:00Z',
      html_url: 'https://github.com/kyle-marks/slug-beta/releases/tag/v1.10.0',
      draft: false,
      prerelease: true,
      body_html: '<h2>Better sessions</h2><p>Sessions stay where you put them.</p>',
      assets: [
        {
          name: 'Slug-1.10.0-universal.dmg',
          browser_download_url: 'https://example.com/Slug-1.10.0-universal.dmg',
          size: 237_000_000,
        },
        { name: 'latest-mac.yml', browser_download_url: 'https://example.com/latest-mac.yml' },
      ],
    },
    {
      tag_name: 'v1.9.0',
      name: 'Slug 1.9.0',
      published_at: '2026-09-11T12:00:00Z',
      html_url: 'https://github.com/kyle-marks/slug-beta/releases/tag/v1.9.0',
      draft: false,
      prerelease: true,
      body_html: '<p>Previous changes.</p>',
      assets: [],
    },
  ]

  const html = site.buildPage?.(releases)

  assert.match(html, /href="https:\/\/example\.com\/Slug-1\.10\.0-universal\.dmg"/)
  assert.match(html, />Download Slug 1\.10\.0</)
  assert.match(html, /macOS 15 or later/)
  assert.match(html, /226 MB/)
  assert.match(html, /Better sessions/)
  assert.match(html, /Slug 1\.9\.0/)
  assert.doesNotMatch(html, /latest-mac\.yml/)
})

test('buildPage explains when no published release is available', async () => {
  const site = await import('../scripts/build-site.mjs')

  assert.throws(() => site.buildPage([]), /No published Slug release was found/)
})

test('buildPage fails clearly when the latest release has no DMG', async () => {
  const site = await import('../scripts/build-site.mjs')
  const releases = [
    {
      tag_name: 'v1.10.0',
      published_at: '2026-09-13T12:00:00Z',
      draft: false,
      assets: [{ name: 'latest-mac.yml' }],
    },
  ]

  assert.throws(() => site.buildPage(releases), /v1\.10\.0 has no DMG installer/)
})

test('buildPage gives a useful summary when release notes are empty', async () => {
  const site = await import('../scripts/build-site.mjs')
  const releases = [
    {
      tag_name: 'v1.10.0',
      published_at: '2026-09-13T12:00:00Z',
      draft: false,
      body_html: '',
      assets: [
        {
          name: 'Slug-1.10.0-universal.dmg',
          browser_download_url: 'https://example.com/slug.dmg',
          size: 237_000_000,
        },
      ],
    },
  ]

  assert.match(site.buildPage(releases), /Maintenance improvements and fixes\./)
})

test('fetchReleases requests GitHub-rendered release-note HTML', async () => {
  const site = await import('../scripts/build-site.mjs')
  let request
  const fakeFetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify([{ tag_name: 'v1.10.0', body_html: '<p>Notes</p>' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const releases = await site.fetchReleases?.(fakeFetch, 'kyle-marks/slug-beta', 'secret-token')

  assert.equal(request?.url, 'https://api.github.com/repos/kyle-marks/slug-beta/releases?per_page=30')
  assert.equal(request?.options.headers.Accept, 'application/vnd.github.html+json')
  assert.equal(request?.options.headers.Authorization, 'Bearer secret-token')
  assert.equal(releases?.[0].body_html, '<p>Notes</p>')
})

test('fetchReleases reports a failed GitHub response clearly', async () => {
  const site = await import('../scripts/build-site.mjs')
  const unavailable = async () => new Response('down', { status: 503 })

  await assert.rejects(
    site.fetchReleases(unavailable, 'kyle-marks/slug-beta'),
    /GitHub Releases request failed \(503\)/,
  )
})

test('writeSite emits the page, brand assets, and frozen appcast', async () => {
  const site = await import('../scripts/build-site.mjs')
  assert.equal(typeof site.writeSite, 'function')

  const root = await mkdtemp(join(tmpdir(), 'slug-site-'))
  const staticDir = join(root, 'static')
  const outputDir = join(root, 'output')
  await mkdir(join(staticDir, 'assets'), { recursive: true })
  await writeFile(join(staticDir, 'assets', 'styles.css'), 'body { color: black; }')
  await writeFile(join(staticDir, 'assets', 'slug-icon.svg'), '<svg></svg>')
  await writeFile(join(root, 'appcast.xml'), '<rss>frozen</rss>')
  const releases = [
    {
      tag_name: 'v1.10.0',
      published_at: '2026-09-13T12:00:00Z',
      html_url: 'https://example.com/release',
      draft: false,
      body_html: '<p>Notes</p>',
      assets: [
        {
          name: 'Slug-1.10.0-universal.dmg',
          browser_download_url: 'https://example.com/slug.dmg',
          size: 237_000_000,
        },
      ],
    },
  ]

  await site.writeSite({
    releases,
    outputDir,
    staticDir,
    appcastPath: join(root, 'appcast.xml'),
  })

  assert.match(await readFile(join(outputDir, 'index.html'), 'utf8'), /Download Slug 1\.10\.0/)
  assert.equal(await readFile(join(outputDir, 'assets', 'styles.css'), 'utf8'), 'body { color: black; }')
  assert.equal(await readFile(join(outputDir, 'assets', 'slug-icon.svg'), 'utf8'), '<svg></svg>')
  assert.equal(await readFile(join(outputDir, 'appcast.xml'), 'utf8'), '<rss>frozen</rss>')
})
