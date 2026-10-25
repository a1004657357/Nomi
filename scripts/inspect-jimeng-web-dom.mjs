import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-jimeng-dom-inspect-'))
const outputDir = path.resolve(
  process.cwd(),
  process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice('--output-dir='.length)
    || 'evals/runs/jimeng-web-dom-inspection',
)
const targetTaskCode = process.argv
  .find((arg) => arg.startsWith('--task-code='))
  ?.slice('--task-code='.length)
  .trim() || ''
const targetConversationTitle = process.argv
  .find((arg) => arg.startsWith('--conversation='))
  ?.slice('--conversation='.length)
  .trim() || ''
const userDataDir = path.join(tempRoot, 'user-data')
const sourceSession = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'nomi',
  'Partitions',
  'nomi-jimeng-runner',
)
const targetSession = path.join(userDataDir, 'Partitions', 'nomi-jimeng-runner')

function copySession() {
  fs.mkdirSync(targetSession, { recursive: true })
  for (const name of ['Cookies', 'Cookies-journal', 'Local Storage', 'IndexedDB']) {
    const source = path.join(sourceSession, name)
    if (!fs.existsSync(source)) continue
    fs.cpSync(source, path.join(targetSession, name), {
      recursive: fs.statSync(source).isDirectory(),
      force: true,
    })
  }
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function safeNetworkUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

copySession()
fs.mkdirSync(outputDir, { recursive: true })
const { app } = await launchNomiApp({
  name: 'nomi-jimeng-dom-inspect',
  tempRoot,
  userDataDir,
  env: { NOMI_SOURCE_RUN: '1', NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability-core') },
})

try {
  const mainWindow = await app.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  const status = await mainWindow.evaluate(() => window.nomiDesktop.jimengWeb.startRunner())
  const deadline = Date.now() + 45_000
  let jimengWindow = null
  while (Date.now() < deadline) {
    jimengWindow = app.windows().find((window) => {
      try {
        return new URL(window.url()).hostname === 'jimeng.jianying.com'
      } catch {
        return false
      }
    }) || null
    if (jimengWindow) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!jimengWindow) throw new Error('JiMeng page window was not found')
  const viewerNetwork = []
  const rememberNetwork = (kind, urlValue, resourceType, status = null) => {
    const url = safeNetworkUrl(urlValue)
    if (!url || !/(?:byteimg|bytescm|vlabstatic)\.com\//i.test(url)) return
    viewerNetwork.push({ kind, url, resourceType, status })
  }
  jimengWindow.on('request', request => {
    rememberNetwork('request', request.url(), request.resourceType())
  })
  jimengWindow.on('response', response => {
    rememberNetwork(
      'response',
      response.url(),
      response.request().resourceType(),
      response.status(),
    )
  })
  await jimengWindow.goto('https://jimeng.jianying.com/ai-tool/image/generate')
  await jimengWindow.waitForLoadState('domcontentloaded')
  await jimengWindow.waitForTimeout(3_000)
  if (targetConversationTitle) {
    const clicked = await jimengWindow.evaluate((title) => {
      const exact = Array.from(document.querySelectorAll('*')).filter((element) => {
        if (!(element instanceof HTMLElement)) return false
        const rect = element.getBoundingClientRect()
        return element.offsetParent !== null
          && rect.left >= 100
          && rect.right <= 620
          && String(element.textContent || '').trim() === title
          && Array.from(element.children).every((child) => String(child.textContent || '').trim() !== title)
      })
      const target = exact[0]
      if (!target) return false
      target.click()
      return true
    }, targetConversationTitle)
    if (!clicked) throw new Error(`JiMeng conversation was not found: ${targetConversationTitle}`)
    await jimengWindow.waitForTimeout(3_000)
  } else if (!targetTaskCode) {
    const smokeConversation = jimengWindow.getByText('保留特定小白机器人元素', { exact: true }).first()
    const defaultConversation = jimengWindow.getByText('默认创作', { exact: true }).first()
    if (await smokeConversation.count()) {
      await smokeConversation.click()
      await jimengWindow.waitForTimeout(3_000)
    } else if (await defaultConversation.count()) {
      await defaultConversation.click()
      await jimengWindow.waitForTimeout(3_000)
    }
  }
  const contentLogs = []
  jimengWindow.on('console', (message) => {
    const text = compactText(message.text())
    if (/Seedance批量|图片|模型|比例|清晰度/.test(text)) contentLogs.push(text)
  })
  const panelWindow = app.windows().find((window) => (
    window.url().startsWith('chrome-extension://') && window.url().includes('/panel.html')
  ))
  const presetProbe = panelWindow
    ? await panelWindow.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://jimeng.jianying.com/*' })
        const tab = tabs.find((entry) => entry.active) || tabs[0]
        if (!tab?.id) return { error: 'JiMeng extension tab was not found' }
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'applyPreset',
          preset: {
            mediaType: 'image',
            model: '图片 5.0 Lite',
            aspectRatio: '9:16',
            resolution: '2K',
          },
        })
        return { tab: { id: tab.id, url: tab.url }, response }
      })
    : { error: 'Extension panel window was not found' }
  await jimengWindow.waitForTimeout(1_000)
  const rawOutputImageUrls = await jimengWindow.evaluate((taskCode) => {
    const recordSelector =
      '[class*="video-record-"], [class*="image-record-"], [class*="ai-generated-record"], '
      + '[class*="generation-record"], [class*="history-item"], [class*="record-item"]'
    const records = Array.from(document.querySelectorAll(recordSelector))
      .filter((record) => (
        !record.closest('#seedance-drawer-container')
        && (!taskCode || String(record.textContent || '').includes(taskCode))
      ))
    const roots = records.length > 0
      ? records
      : taskCode
        ? []
        : [document.querySelector('main') || document.body]
    const urls = []
    for (const root of roots) {
      for (const element of root.querySelectorAll('img')) {
        if (element.closest('[class*="record-reference"], #seedance-drawer-container')) continue
        const url = element.currentSrc || element.src || ''
        if (!/^https:\/\//i.test(url) || urls.includes(url)) continue
        urls.push(url)
      }
    }
    return urls.slice(0, 4)
  }, targetTaskCode)
  const targetImageLocator = jimengWindow.locator('[data-nomi-original-probe-target="true"]')
  if (rawOutputImageUrls[0]) {
    await jimengWindow.evaluate((previewUrl) => {
      const comparable = (value) => {
        try {
          const url = new URL(String(value || ''))
          return `${url.origin}${url.pathname.replace(/~tplv[^/]*$/i, '')}`
        } catch {
          return ''
        }
      }
      const matches = Array.from(document.querySelectorAll('img'))
        .filter((element) => (
          !element.closest('aside, header, nav, [class*="conversation-item"]')
          && comparable(element.currentSrc || element.src) === comparable(previewUrl)
        ))
      const target = matches
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false
          const rect = element.getBoundingClientRect()
          return element.offsetParent !== null && rect.width > 0 && rect.height > 0
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect()
          const rightRect = right.getBoundingClientRect()
          return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height)
        })[0] || matches.at(-1)
      target?.setAttribute('data-nomi-original-probe-target', 'true')
      target?.scrollIntoView({ block: 'center', inline: 'center' })
    }, rawOutputImageUrls[0])
    if (await targetImageLocator.count()) {
      await targetImageLocator.hover({ force: true })
      await jimengWindow.waitForTimeout(500)
    }
  }
  const targetImageContext = rawOutputImageUrls[0]
    ? await jimengWindow.evaluate((previewUrl) => {
        const comparable = (value) => {
          try {
            const url = new URL(String(value || ''))
            return `${url.origin}${url.pathname.replace(/~tplv[^/]*$/i, '')}`
          } catch {
            return ''
          }
        }
        const describe = (element) => {
          const rect = element.getBoundingClientRect()
          const attributes = {}
          for (const name of element.getAttributeNames()) {
            if (/^(?:src|href|srcset)$/i.test(name)) continue
            attributes[name] = String(element.getAttribute(name) || '').slice(0, 180)
          }
          return {
            tag: element.tagName.toLowerCase(),
            className: String(element.className || '').slice(0, 240),
            text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
            attributes,
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          }
        }
        const image = Array.from(document.querySelectorAll('img'))
          .find((element) => (
            !element.closest('aside, header, nav, [class*="conversation-item"]')
            && comparable(element.currentSrc || element.src) === comparable(previewUrl)
          ))
        if (!image) return { error: 'target image not found' }
        const ancestors = []
        let current = image
        for (let index = 0; current && index < 7; index += 1) {
          ancestors.push(describe(current))
          current = current.parentElement
        }
        const card = image.closest('[class*="image-record-item"]') || image.parentElement
        const controls = card
          ? Array.from(card.querySelectorAll('button, [role="button"], [data-apm-action]')).map(describe)
          : []
        return { ancestors, controls }
      }, rawOutputImageUrls[0])
    : null
  let playwrightClickProbe = { success: false, error: 'Target image was not found' }
  if (await targetImageLocator.count()) {
    try {
      await targetImageLocator.click({ force: true })
      const downloadButton = jimengWindow.getByText('下载', { exact: true }).filter({ visible: true }).first()
      await downloadButton.waitFor({ state: 'visible', timeout: 5000 })
      playwrightClickProbe = { success: true }
      const closeButton = jimengWindow.locator('[class*="close-button"]').filter({ visible: true }).first()
      if (await closeButton.count()) await closeButton.click({ force: true })
    } catch (error) {
      playwrightClickProbe = { success: false, error: String(error?.message || error) }
    }
  }
  const extensionImageVariantProbe = panelWindow
    ? await panelWindow.evaluate(async (sourceUrls) => {
        const safeUrl = (value) => {
          try {
            const url = new URL(String(value || ''))
            return `${url.origin}${url.pathname}`
          } catch {
            return ''
          }
        }
        const variantUrl = (sourceValue, variant) => {
          const url = new URL(sourceValue)
          if (variant === 'scoped-origin') {
            url.pathname = url.pathname.replace(
              /~tplv-([^-]+)-[^/]*$/i,
              '~tplv-$1-origin.image',
            )
          } else if (variant === 'generic-origin') {
            url.pathname = url.pathname.replace(/~tplv[^/]*$/i, '~tplv-origin.image')
          } else if (variant === 'bare') {
            url.pathname = url.pathname.replace(/~tplv[^/]*$/i, '')
          } else if (variant === 'resize-2048') {
            url.pathname = url.pathname.replace(
              /~tplv-([^-]+)-[^/]*$/i,
              '~tplv-$1-aigc_resize:2048:2048.webp',
            )
          } else if (variant === 'download-original') {
            url.pathname = url.pathname.replace(
              /~tplv-([^-]+)-[^/]*$/i,
              '~tplv-$1-aigc_resize:0:0.png',
            )
          }
          return url
        }
        const probe = async (source, variant) => {
          const url = variantUrl(source, variant)
          try {
            const response = await fetch(url.toString(), { cache: 'no-store' })
            const blob = await response.blob()
            let width = 0
            let height = 0
            try {
              const bitmap = await createImageBitmap(blob)
              width = bitmap.width
              height = bitmap.height
              bitmap.close()
            } catch {
              // HTTP status and payload size remain useful.
            }
            return {
              variant,
              url: safeUrl(url),
              status: response.status,
              size: blob.size,
              type: blob.type,
              width,
              height,
            }
          } catch (error) {
            return { variant, url: safeUrl(url), error: String(error?.message || error) }
          }
        }
        const result = []
        for (const source of sourceUrls) {
          result.push({
            source: safeUrl(source),
            variants: await Promise.all(
              ['current', 'scoped-origin', 'generic-origin', 'bare', 'resize-2048', 'download-original']
                .map((variant) => probe(source, variant)),
            ),
          })
        }
        return result
      }, rawOutputImageUrls)
    : []
  const extensionOriginalProbe = panelWindow && rawOutputImageUrls[0]
    ? await panelWindow.evaluate(async previewUrl => {
        const safeUrl = input => {
          try {
            const url = new URL(String(input || ''))
            return `${url.origin}${url.pathname}`
          } catch {
            return ''
          }
        }
        const tabs = await chrome.tabs.query({ url: 'https://jimeng.jianying.com/*' })
        const tab = tabs.find(entry => entry.active) || tabs[0]
        if (!tab?.id) return { success: false, error: 'JiMeng extension tab was not found' }
        const result = await chrome.tabs.sendMessage(tab.id, {
          action: 'resolveOriginalImageUrl',
          previewUrl,
        })
        if (!result?.success || !result.originalUrl) {
          return { success: false, error: result?.error || 'Original URL was not returned' }
        }
        try {
          const response = await fetch(result.originalUrl, {
            credentials: 'include',
            cache: 'no-store',
            referrer: 'https://jimeng.jianying.com/',
          })
          const blob = await response.blob()
          let width = 0
          let height = 0
          try {
            const bitmap = await createImageBitmap(blob)
            width = bitmap.width
            height = bitmap.height
            bitmap.close()
          } catch {
            // HTTP and byte-size evidence remain useful.
          }
          return {
            success: response.ok,
            url: safeUrl(result.originalUrl),
            status: response.status,
            size: blob.size,
            type: blob.type,
            width,
            height,
          }
        } catch (error) {
          return {
            success: false,
            url: safeUrl(result.originalUrl),
            error: String(error?.message || error),
          }
        }
      }, rawOutputImageUrls[0])
    : { success: false, error: 'Extension panel or image candidate was not found' }
  const viewerOpened = false

  const viewerImages = await jimengWindow.evaluate(() => {
    const safeUrl = (value) => {
      try {
        const url = new URL(String(value || ''))
        return `${url.origin}${url.pathname}`
      } catch {
        return ''
      }
    }
    return Array.from(document.querySelectorAll('img'))
      .filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest('#seedance-drawer-container')) return false
        const rect = element.getBoundingClientRect()
        const source = element.currentSrc || element.src || ''
        return element.offsetParent !== null
          && Math.max(rect.width, rect.height) >= 240
          && /^https:\/\//i.test(source)
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const attributes = {}
        for (const name of element.getAttributeNames()) {
          const value = element.getAttribute(name) || ''
          attributes[name] = /^https?:\/\//i.test(value) ? safeUrl(value) : value.slice(0, 240)
        }
        return {
          current: safeUrl(element.currentSrc),
          src: safeUrl(element.src),
          naturalWidth: element.naturalWidth || 0,
          naturalHeight: element.naturalHeight || 0,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          className: String(element.className || '').slice(0, 240),
          parentClassName: String(element.parentElement?.className || '').slice(0, 240),
          attributes,
        }
      })
  })

  const snapshot = await jimengWindow.evaluate(async () => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false
      if (element.closest('#seedance-drawer-container')) return false
      const rect = element.getBoundingClientRect()
      return element.offsetParent !== null && rect.width > 0 && rect.height > 0
    }
    const describe = (element) => {
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        className: typeof element.className === 'string' ? element.className.slice(0, 240) : '',
        role: element.getAttribute('role') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        title: element.getAttribute('title') || '',
        dataTestId: element.getAttribute('data-testid') || '',
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }
    }
    const select = (selector, limit = 80) => Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .slice(0, limit)
      .map(describe)
    const safeUrl = (value) => {
      try {
        const url = new URL(String(value || ''))
        return `${url.origin}${url.pathname}`
      } catch {
        return ''
      }
    }
    const imageElements = Array.from(document.querySelectorAll('main img, [class*="record"] img'))
      .filter((element) => {
        const source = element.currentSrc || element.src || ''
        return visible(element)
          && /^https:\/\/[^/]*(?:byteimg|bytescm|vlabstatic)\.com\//i.test(source)
          && Math.max(element.naturalWidth || 0, element.naturalHeight || 0) >= 128
      })
    const generatedImageSources = imageElements.slice(0, 12).map((element) => ({
      current: safeUrl(element.currentSrc),
      src: safeUrl(element.src),
      srcset: String(element.getAttribute('srcset') || '')
        .split(',')
        .map((part) => safeUrl(part.trim().split(/\s+/, 1)[0]))
        .filter(Boolean),
      naturalWidth: element.naturalWidth || 0,
      naturalHeight: element.naturalHeight || 0,
      recordClass: String(element.closest('[class*="record"]')?.className || '').slice(0, 180),
      attributeNames: element.getAttributeNames(),
    }))
    const sourceUrls = Array.from(new Set(imageElements
      .map((element) => element.currentSrc || element.src || '')
      .filter(Boolean)))
      .slice(0, 6)
    const probeVariant = async (urlValue, variant) => {
      const url = new URL(urlValue)
      if (variant === 'origin') {
        url.pathname = url.pathname.replace(/~tplv[^/]*$/i, '~tplv-origin.image')
      } else if (variant === 'bare') {
        url.pathname = url.pathname.replace(/~tplv[^/]*$/i, '')
      }
      try {
        const response = await fetch(url.toString(), {
          credentials: 'include',
          cache: 'no-store',
          referrer: 'https://jimeng.jianying.com/',
        })
        const blob = await response.blob()
        let width = 0
        let height = 0
        try {
          const bitmap = await createImageBitmap(blob)
          width = bitmap.width
          height = bitmap.height
          bitmap.close()
        } catch {
          // Keep HTTP and byte-size evidence even when the body is not decodable.
        }
        return {
          variant,
          url: safeUrl(url),
          status: response.status,
          size: blob.size,
          type: blob.type,
          width,
          height,
        }
      } catch (error) {
        return { variant, url: safeUrl(url), error: String(error?.message || error) }
      }
    }
    const imageVariantProbe = []
    for (const source of sourceUrls) {
      imageVariantProbe.push({
        source: safeUrl(source),
        variants: await Promise.all(
          ['current', 'origin', 'bare'].map((variant) => probeVariant(source, variant)),
        ),
      })
    }
    return {
      url: location.href,
      title: document.title,
      toolbarCandidates: select(
        '[class*="toolbar"], [class*="setting"], [class*="config"], [class*="generator"]',
        120,
      ),
      selects: select('.lv-select, [role="combobox"], [class*="select"]', 120),
      buttons: select('button, [role="button"]', 160),
      links: select('a[href]', 120),
      openMenu: select(
        '[role="option"], [role="menuitem"], [class*="select-option"], [class*="option"], [class*="menu"]',
        160,
      ),
      generatedImageSources,
      imageVariantProbe,
    }
  })

  const screenshotPath = path.join(outputDir, 'jimeng-image-page.png')
  const reportPath = path.join(outputDir, 'dom.json')
  await jimengWindow.screenshot({ path: screenshotPath, fullPage: false })
  fs.writeFileSync(reportPath, `${JSON.stringify({
    runner: {
      available: Boolean(status?.available),
      clientOnline: Boolean(status?.clientOnline),
      drawerReady: Boolean(status?.drawerReady),
      extensionDir: compactText(status?.extensionDir),
      error: compactText(status?.error),
    },
    targetTaskCode,
    targetConversationTitle,
    targetImageContext,
    playwrightClickProbe,
    presetProbe,
    contentLogs,
    extensionImageVariantProbe,
    extensionOriginalProbe,
    viewerOpened,
    viewerImages,
    viewerNetwork: viewerNetwork.slice(-120),
    page: snapshot,
  }, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, screenshotPath, runner: status }, null, 2))
} finally {
  await app.close().catch(() => undefined)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
