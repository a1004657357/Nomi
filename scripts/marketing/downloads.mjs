const releaseBase = 'https://github.com/aqm857886159/Nomi/releases/latest/download'

export const downloadUrls = Object.freeze({
  windowsX64: `${releaseBase}/Nomi-windows-setup.exe`,
  macArm64: `${releaseBase}/Nomi-mac-arm64.dmg`,
  macX64: `${releaseBase}/Nomi-mac-intel.dmg`,
})

export function selectDownload({ platform = '', userAgent = '', architecture = '' } = {}) {
  const platformText = `${platform} ${userAgent}`.toLowerCase()
  const architectureText = String(architecture).toLowerCase()

  if (/win/.test(platformText) && !/arm/.test(architectureText)) return downloadUrls.windowsX64
  if (!/mac|iphone|ipad/.test(platformText)) return null
  if (/arm|aarch64/.test(architectureText) || /arm64/.test(platformText)) return downloadUrls.macArm64
  if (/x86|x64|intel/.test(architectureText) || /intel mac/.test(platformText)) return downloadUrls.macX64
  return null
}

