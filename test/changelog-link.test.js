import { describe, test, expect } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs'

describe('Full Changelog Link', () => {
  const sourcePath = path.resolve(import.meta.dir, '../src/core.ts')

  test('adds compare link when prevTag is specified', async () => {
    process.env.GITHUB_TOKEN = 'fake-token'

    const originalFetch = global.fetch
    const originalExistsSync = fs.existsSync

    fs.existsSync = () => false

    global.fetch = async (url, opts) => {
      const u = url.toString()
      const headers = new Map([['content-type', 'application/json']])

      if (u.endsWith('/repos/owner/repo')) {
        return { ok: true, status: 200, headers, json: async () => ({ default_branch: 'main' }) }
      }

      if (u.includes('/releases/tags/v1.0.0')) {
        return {
          ok: true, status: 200, headers,
          json: async () => ({ id: 1, tag_name: 'v1.0.0', created_at: '2024-01-01T00:00:00Z' })
        }
      }

      if (u.includes('/graphql')) {
        const body = opts ? JSON.parse(opts.body) : {}
        if (body.query?.includes('history')) {
          return {
            ok: true, status: 200, headers,
            json: async () => ({
              data: {
                repository: {
                  object: {
                    history: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null }
                    }
                  }
                }
              }
            })
          }
        }
        return { ok: true, status: 200, headers, json: async () => ({ data: {} }) }
      }

      return { ok: false, status: 404, headers, text: async () => 'Not found' }
    }

    try {
      const { run } = await import(sourcePath)
      const res = await run({
        repo: 'owner/repo',
        prevTag: 'v1.0.0',
        tag: 'v2.0.0'
      })

      expect(res.release.body).toContain('**Full Changelog**: https://github.com/owner/repo/compare/v1.0.0...v2.0.0')
    } finally {
      global.fetch = originalFetch
      fs.existsSync = originalExistsSync
      delete process.env.GITHUB_TOKEN
    }
  })

  test('adds commits link when no prevTag', async () => {
    process.env.GITHUB_TOKEN = 'fake-token'

    const originalFetch = global.fetch
    const originalExistsSync = fs.existsSync

    fs.existsSync = () => false

    global.fetch = async (url, opts) => {
      const u = url.toString()
      const headers = new Map([['content-type', 'application/json']])

      if (u.endsWith('/repos/owner/repo')) {
        return { ok: true, status: 200, headers, json: async () => ({ default_branch: 'main' }) }
      }

      if (u.includes('/releases')) {
        return { ok: true, status: 200, headers, json: async () => [] }
      }

      if (u.includes('/graphql')) {
        const body = opts ? JSON.parse(opts.body) : {}
        if (body.query?.includes('history')) {
          return {
            ok: true, status: 200, headers,
            json: async () => ({
              data: {
                repository: {
                  object: {
                    history: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null }
                    }
                  }
                }
              }
            })
          }
        }
        return { ok: true, status: 200, headers, json: async () => ({ data: {} }) }
      }

      if (u.includes('/compare/') || u.includes('/commits/')) {
        return { ok: true, status: 200, headers, json: async () => ({ commits: [] }) }
      }

      return { ok: false, status: 404, headers, text: async () => 'Not found' }
    }

    try {
      const { run } = await import(sourcePath)
      const res = await run({
        repo: 'owner/repo',
        tag: 'v1.0.0'
      })

      expect(res.release.body).toContain('**Full Changelog**: https://github.com/owner/repo/commits/v1.0.0')
    } finally {
      global.fetch = originalFetch
      fs.existsSync = originalExistsSync
      delete process.env.GITHUB_TOKEN
    }
  })

  test('preview mode prefers target over tag', async () => {
    process.env.GITHUB_TOKEN = 'fake-token'

    const originalFetch = global.fetch
    const originalExistsSync = fs.existsSync

    fs.existsSync = () => false

    global.fetch = async (url, opts) => {
      const u = url.toString()
      const headers = new Map([['content-type', 'application/json']])

      if (u.endsWith('/repos/owner/repo')) {
        return { ok: true, status: 200, headers, json: async () => ({ default_branch: 'main' }) }
      }

      if (u.includes('/releases/tags/v1.0.0')) {
        return {
          ok: true, status: 200, headers,
          json: async () => ({ id: 1, tag_name: 'v1.0.0', created_at: '2024-01-01T00:00:00Z' })
        }
      }

      if (u.includes('/graphql')) {
        const body = opts ? JSON.parse(opts.body) : {}
        if (body.query?.includes('history')) {
          return {
            ok: true, status: 200, headers,
            json: async () => ({
              data: {
                repository: {
                  object: {
                    history: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null }
                    }
                  }
                }
              }
            })
          }
        }
        return { ok: true, status: 200, headers, json: async () => ({ data: {} }) }
      }

      return { ok: false, status: 404, headers, text: async () => 'Not found' }
    }

    try {
      const { run } = await import(sourcePath)

      // Test preview mode - should use target
      const res1 = await run({
        repo: 'owner/repo',
        prevTag: 'v1.0.0',
        tag: 'v2.0.0',
        target: 'develop',
        preview: true
      })
      expect(res1.release.body).toContain('**Full Changelog**: https://github.com/owner/repo/compare/v1.0.0...develop')

      // Test non-preview mode - should use tag
      const res2 = await run({
        repo: 'owner/repo',
        prevTag: 'v1.0.0',
        tag: 'v2.0.0',
        target: 'develop',
        preview: false
      })
      expect(res2.release.body).toContain('**Full Changelog**: https://github.com/owner/repo/compare/v1.0.0...v2.0.0')
    } finally {
      global.fetch = originalFetch
      fs.existsSync = originalExistsSync
      delete process.env.GITHUB_TOKEN
    }
  })
})
