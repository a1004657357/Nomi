import React from 'react'

export function useIntegrationVerificationRefresh(refresh: () => void): () => void {
  const timer = React.useRef<number | null>(null)
  React.useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  return React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    refresh()
    let attempts = 0
    const tick = () => {
      refresh()
      attempts += 1
      timer.current = attempts < 60 ? window.setTimeout(tick, 500) : null
    }
    timer.current = window.setTimeout(tick, 500)
  }, [refresh])
}
