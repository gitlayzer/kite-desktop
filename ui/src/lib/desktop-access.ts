export const DESKTOP_ACCESS_HEADER = 'X-Kite-Desktop-Token'

export function getDesktopAccessToken(): string {
  return window.kiteWindow?.desktopToken || ''
}

export function appendDesktopAccessHeader(headers: Record<string, string>) {
  const token = getDesktopAccessToken()
  if (token) {
    headers[DESKTOP_ACCESS_HEADER] = token
  }
}

export function appendDesktopAccessParam(params: URLSearchParams) {
  const token = getDesktopAccessToken()
  if (token) {
    params.set('desktopToken', token)
  }
}
