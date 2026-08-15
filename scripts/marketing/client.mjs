export function homepageClientJs(downloadUrls) {
  return `(() => {
  const downloadUrls = ${JSON.stringify(downloadUrls)}
  const localeKey = 'nomi_locale'
  const pageLocale = document.documentElement.lang
  const preferred = (() => { try { return localStorage.getItem(localeKey) } catch { return null } })()
  const browserLanguages = navigator.languages || [navigator.language || '']
  const wantsEnglish = browserLanguages[0]?.toLowerCase().startsWith('en') && !browserLanguages.some((value) => value.toLowerCase().startsWith('zh'))
  if (location.pathname === '/' && !preferred && wantsEnglish) location.replace('/en/')
  document.querySelectorAll('[data-locale-choice]').forEach((link) => link.addEventListener('click', () => {
    try { localStorage.setItem(localeKey, link.dataset.localeChoice) } catch {}
  }))
  const dialog = document.querySelector('#launch-film')
  const trigger = document.querySelector('[data-open-film]')
  const close = document.querySelector('[data-close-film]')
  if (dialog && trigger && typeof dialog.showModal === 'function') {
    trigger.addEventListener('click', (event) => { event.preventDefault(); dialog.showModal() })
    close?.addEventListener('click', () => dialog.close())
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelector('[data-hero-video]')?.pause()
  const resolvePlatformDownload = async () => {
    const platform = navigator.platform || ''
    const userAgent = navigator.userAgent || ''
    let architecture = ''
    if (navigator.userAgentData?.getHighEntropyValues) {
      try { architecture = (await navigator.userAgentData.getHighEntropyValues(['architecture'])).architecture || '' } catch {}
    }
    const platformText = (platform + ' ' + userAgent).toLowerCase()
    const architectureText = architecture.toLowerCase()
    const url = /win/.test(platformText) && !/arm/.test(architectureText)
      ? downloadUrls.windowsX64
      : /mac|iphone|ipad/.test(platformText) && /arm|aarch64/.test(architectureText)
        ? downloadUrls.macArm64
        : /mac|iphone|ipad/.test(platformText) && (/x86|x64|intel/.test(architectureText) || /intel mac/.test(platformText))
          ? downloadUrls.macX64
          : null
    return url || null
  }
  const applyPlatformDownload = async () => {
    const url = await resolvePlatformDownload()
    if (!url) return
    document.querySelectorAll('[data-download-nomi]').forEach((link) => {
      link.href = url
      link.removeAttribute('target')
      link.removeAttribute('rel')
    })
  }
  document.querySelectorAll('[data-download-nomi]').forEach((link) => link.addEventListener('click', async (event) => {
    event.preventDefault()
    const url = await resolvePlatformDownload()
    location.href = url || link.href
  }))
  void applyPlatformDownload()
  document.documentElement.dataset.enhanced = 'true'
  document.documentElement.dataset.locale = pageLocale
})()`
}
