export type OnboardingVendorAvailability = {
  enabled: boolean
  authType: string
  hasApiKey: boolean
}

export function onboardingVendorIsUsable(
  vendor: OnboardingVendorAvailability | null | undefined,
): boolean {
  if (!vendor?.enabled) return false
  return vendor.authType === 'none' || vendor.hasApiKey
}
