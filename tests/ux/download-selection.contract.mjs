import assert from 'node:assert/strict'
import { downloadUrls, selectDownload } from '../../scripts/marketing/downloads.mjs'

assert.equal(selectDownload({ platform: 'Win32', architecture: 'x86' }), downloadUrls.windowsX64)
assert.equal(selectDownload({ platform: 'Win32', architecture: 'arm' }), null)
assert.equal(selectDownload({ platform: 'MacIntel', architecture: 'arm' }), downloadUrls.macArm64)
assert.equal(selectDownload({ platform: 'MacIntel', architecture: 'x86_64' }), downloadUrls.macX64)
assert.equal(selectDownload({ platform: 'Linux x86_64', architecture: 'x86_64' }), null)
assert.equal(selectDownload({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }), downloadUrls.macX64)
assert.equal(selectDownload({ platform: 'MacIntel' }), null)

console.log('DOWNLOAD SELECTION CONTRACT PASS')

