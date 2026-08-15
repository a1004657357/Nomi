const localizedImage = {
  'zh-CN': '/assets/social-preview-zh.jpg',
  en: '/assets/social-preview-en.jpg',
}

export function buildMetadata(locale, content, shared) {
  const canonical = `${shared.siteUrl}${content.path}`
  const image = `${shared.siteUrl}${localizedImage[locale]}`

  return {
    title: content.meta.title,
    description: content.meta.description,
    canonical,
    alternates: [
      { lang: 'zh-CN', href: `${shared.siteUrl}/` },
      { lang: 'en', href: `${shared.siteUrl}/en/` },
      { lang: 'x-default', href: `${shared.siteUrl}/` },
    ],
    openGraph: {
      locale: content.ogLocale,
      title: content.meta.title,
      description: content.meta.description,
      image,
      imageAlt: content.meta.imageAlt,
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Nomi',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'macOS, Windows',
      codeRepository: shared.repositoryUrl,
      license: shared.licenseUrl,
      url: canonical,
      softwareVersion: shared.version,
      downloadUrl: shared.releaseUrl,
      inLanguage: content.htmlLang,
    },
  }
}
