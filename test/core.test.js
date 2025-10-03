/* eslint-env jest */
const path = require('node:path')
const fs = require('node:fs')

describe('actionutils/gh-release-notes core', () => {
  const dist = path.resolve(__dirname, '../dist/index.cjs')
  const owner = 'acme'
  const repo = 'demo'

  beforeEach(() => {
    jest.resetModules()
    process.env.GITHUB_TOKEN = 'test'
    // default fetch stub: repo info ok
    global.fetch = async (url) => {
      const u = url.toString()
      if (u.endsWith(`/repos/${owner}/${repo}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        }
      }
      throw new Error('Unexpected fetch: ' + u)
    }
  })

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
    delete global.fetch
  })

  test('auto-loads local .github/release-drafter.yml when --config is omitted', async () => {
    const localCfg = path.resolve(process.cwd(), '.github/release-drafter.yml')
    const existsOrig = fs.existsSync
    const readOrig = fs.readFileSync
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === localCfg) return true
      return existsOrig(p)
    })
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (p === localCfg) return 'template: "Hello"\n'
      return readOrig(p, enc)
    })

    jest.doMock(
      'release-drafter/lib/schema',
      () => ({
        validateSchema: (ctx, cfg) => ({
          ...cfg,
          'filter-by-commitish': false,
          'include-pre-releases': false,
          'tag-prefix': '',
          prerelease: false,
          latest: 'true',
        }),
      }),
      { virtual: true }
    )

    const findCommitsWithAssociatedPullRequests = jest
      .fn()
      .mockResolvedValue({ commits: [], pullRequests: [] })
    const generateReleaseInfo = jest.fn().mockReturnValue({ body: 'OK' })
    const findReleases = jest
      .fn()
      .mockResolvedValue({ draftRelease: null, lastRelease: null })
    jest.doMock(
      'release-drafter/lib/commits',
      () => ({ findCommitsWithAssociatedPullRequests }),
      { virtual: true }
    )
    jest.doMock(
      'release-drafter/lib/releases',
      () => ({ generateReleaseInfo, findReleases }),
      { virtual: true }
    )

    const { run } = require(dist)
    const res = await run({ repo: `${owner}/${repo}` })
    expect(res.release.body).toBe('OK')
    expect(findCommitsWithAssociatedPullRequests).toHaveBeenCalled()
    expect(generateReleaseInfo).toHaveBeenCalled()
  })

  test('uses provided local --config file (yaml)', async () => {
    const cfgPath = path.resolve(__dirname, 'tmp-config.yml')
    const readOrig = fs.readFileSync
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (p === cfgPath) return 'template: "Local"\n'
      return readOrig(p, enc)
    })
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ default_branch: 'main' }),
    })

    jest.doMock(
      'release-drafter/lib/schema',
      () => ({
        validateSchema: (ctx, cfg) => ({
          ...cfg,
          'filter-by-commitish': false,
          'include-pre-releases': false,
          'tag-prefix': '',
          prerelease: false,
          latest: 'true',
        }),
      }),
      { virtual: true }
    )
    const findCommitsWithAssociatedPullRequests = jest
      .fn()
      .mockResolvedValue({ commits: [], pullRequests: [] })
    const generateReleaseInfo = jest.fn().mockReturnValue({ body: 'OK-LOCAL' })
    const findReleases = jest
      .fn()
      .mockResolvedValue({ draftRelease: null, lastRelease: null })
    jest.doMock(
      'release-drafter/lib/commits',
      () => ({ findCommitsWithAssociatedPullRequests }),
      { virtual: true }
    )
    jest.doMock(
      'release-drafter/lib/releases',
      () => ({ generateReleaseInfo, findReleases }),
      { virtual: true }
    )

    const { run } = require(dist)
    const res = await run({ repo: `${owner}/${repo}`, config: cfgPath })
    expect(res.release.body).toBe('OK-LOCAL')
    expect(generateReleaseInfo).toHaveBeenCalled()
  })

  test('passes flags to findReleases and tag to generateReleaseInfo', async () => {
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ default_branch: 'main' }),
    })
    // ensure previous fs spies are reset
    if (fs.existsSync.mockRestore) fs.existsSync.mockRestore()
    if (fs.readFileSync.mockRestore) fs.readFileSync.mockRestore()
    const flags = {
      'filter-by-commitish': true,
      'include-pre-releases': true,
      'tag-prefix': 'v',
      prerelease: true,
      latest: 'legacy',
    }
    jest.doMock(
      'release-drafter/lib/schema',
      () => ({ validateSchema: (ctx, cfg) => ({ ...cfg, ...flags }) }),
      { virtual: true }
    )
    const findCommitsWithAssociatedPullRequests = jest
      .fn()
      .mockResolvedValue({ commits: [], pullRequests: [] })
    const generateReleaseInfo = jest.fn().mockReturnValue({ body: 'OK' })
    const findReleases = jest
      .fn()
      .mockResolvedValue({ draftRelease: null, lastRelease: null })
    jest.doMock(
      'release-drafter/lib/commits',
      () => ({ findCommitsWithAssociatedPullRequests }),
      { virtual: true }
    )
    jest.doMock(
      'release-drafter/lib/releases',
      () => ({ generateReleaseInfo, findReleases }),
      { virtual: true }
    )

    const { run } = require(dist)
    await run({ repo: `${owner}/${repo}`, target: 'main', tag: 'v1.2.3' })
    const args = findReleases.mock.calls[0][0]
    expect(args.filterByCommitish).toBe(true)
    expect(args.includePreReleases).toBe(true)
    expect(args.tagPrefix).toBe('v')
    const genArgs = generateReleaseInfo.mock.calls[0][0]
    expect(genArgs.tag).toBe('v1.2.3')
  })
})
