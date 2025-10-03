import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

describe('actionutils/gh-release-notes core', () => {
  const dist = path.resolve(import.meta.dir, '../dist/index.cjs')
  const owner = 'acme'
  const repo = 'demo'

  let originalFetch
  let originalExistsSync
  let originalReadFileSync

  beforeEach(() => {
    // Clear module cache
    if (require.cache[dist]) {
      delete require.cache[dist]
    }

    process.env.GITHUB_TOKEN = 'test'
    originalFetch = global.fetch
    originalExistsSync = fs.existsSync
    originalReadFileSync = fs.readFileSync

    // default fetch stub: repo info ok
    global.fetch = mock(async (url) => {
      const u = url.toString()
      if (u.endsWith(`/repos/${owner}/${repo}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        }
      }
      throw new Error('Unexpected fetch: ' + u)
    })
  })

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
    global.fetch = originalFetch
    fs.existsSync = originalExistsSync
    fs.readFileSync = originalReadFileSync

    // Clear mocked modules
    if (require.cache[dist]) {
      delete require.cache[dist]
    }
  })

  test('auto-loads local .github/release-drafter.yml when --config is omitted', async () => {
    const localCfg = path.resolve(process.cwd(), '.github/release-drafter.yml')

    fs.existsSync = mock((p) => {
      if (p === localCfg) return true
      return originalExistsSync(p)
    })

    fs.readFileSync = mock((p, enc) => {
      if (p === localCfg) return 'template: "Hello"\n'
      return originalReadFileSync(p, enc)
    })

    const findCommitsWithAssociatedPullRequests = mock(() =>
      Promise.resolve({ commits: [], pullRequests: [] })
    )
    const generateReleaseInfo = mock(() => ({ body: 'OK' }))
    const findReleases = mock(() =>
      Promise.resolve({ draftRelease: null, lastRelease: null })
    )

    // Mock release-drafter modules
    require.cache[require.resolve('release-drafter/lib/schema')] = {
      exports: {
        validateSchema: (ctx, cfg) => ({
          ...cfg,
          'filter-by-commitish': false,
          'include-pre-releases': false,
          'tag-prefix': '',
          prerelease: false,
          latest: 'true',
        }),
      }
    }

    require.cache[require.resolve('release-drafter/lib/commits')] = {
      exports: { findCommitsWithAssociatedPullRequests }
    }

    require.cache[require.resolve('release-drafter/lib/releases')] = {
      exports: { generateReleaseInfo, findReleases }
    }

    const { run } = require(dist)
    const res = await run({ repo: `${owner}/${repo}` })
    expect(res.release.body).toBe('OK')
    expect(findCommitsWithAssociatedPullRequests).toHaveBeenCalled()
    expect(generateReleaseInfo).toHaveBeenCalled()
  })

  test('uses provided local --config file (yaml)', async () => {
    const cfgPath = path.resolve(import.meta.dir, 'tmp-config.yml')

    fs.readFileSync = mock((p, enc) => {
      if (p === cfgPath) return 'template: "Local"\n'
      return originalReadFileSync(p, enc)
    })

    global.fetch = mock(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ default_branch: 'main' }),
    }))

    const findCommitsWithAssociatedPullRequests = mock(() =>
      Promise.resolve({ commits: [], pullRequests: [] })
    )
    const generateReleaseInfo = mock(() => ({ body: 'OK-LOCAL' }))
    const findReleases = mock(() =>
      Promise.resolve({ draftRelease: null, lastRelease: null })
    )

    require.cache[require.resolve('release-drafter/lib/schema')] = {
      exports: {
        validateSchema: (ctx, cfg) => ({
          ...cfg,
          'filter-by-commitish': false,
          'include-pre-releases': false,
          'tag-prefix': '',
          prerelease: false,
          latest: 'true',
        }),
      }
    }

    require.cache[require.resolve('release-drafter/lib/commits')] = {
      exports: { findCommitsWithAssociatedPullRequests }
    }

    require.cache[require.resolve('release-drafter/lib/releases')] = {
      exports: { generateReleaseInfo, findReleases }
    }

    const { run } = require(dist)
    const res = await run({ repo: `${owner}/${repo}`, config: cfgPath })
    expect(res.release.body).toBe('OK-LOCAL')
    expect(generateReleaseInfo).toHaveBeenCalled()
  })

  test('passes flags to findReleases and tag to generateReleaseInfo', async () => {
    global.fetch = mock(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ default_branch: 'main' }),
    }))

    const flags = {
      'filter-by-commitish': true,
      'include-pre-releases': true,
      'tag-prefix': 'v',
      prerelease: true,
      latest: 'legacy',
    }

    const findCommitsWithAssociatedPullRequests = mock(() =>
      Promise.resolve({ commits: [], pullRequests: [] })
    )
    const generateReleaseInfo = mock(() => ({ body: 'OK' }))
    const findReleases = mock(() =>
      Promise.resolve({ draftRelease: null, lastRelease: null })
    )

    require.cache[require.resolve('release-drafter/lib/schema')] = {
      exports: {
        validateSchema: (ctx, cfg) => ({ ...cfg, ...flags })
      }
    }

    require.cache[require.resolve('release-drafter/lib/commits')] = {
      exports: { findCommitsWithAssociatedPullRequests }
    }

    require.cache[require.resolve('release-drafter/lib/releases')] = {
      exports: { generateReleaseInfo, findReleases }
    }

    const { run } = require(dist)
    await run({ repo: `${owner}/${repo}`, target: 'main', tag: 'v1.2.3' })

    const findReleasesCall = findReleases.mock.calls[0]
    const args = findReleasesCall[0]
    expect(args.filterByCommitish).toBe(true)
    expect(args.includePreReleases).toBe(true)
    expect(args.tagPrefix).toBe('v')

    const genCall = generateReleaseInfo.mock.calls[0]
    const genArgs = genCall[0]
    expect(genArgs.tag).toBe('v1.2.3')
  })
})
