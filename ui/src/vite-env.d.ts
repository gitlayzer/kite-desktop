/// <reference types="vite/client" />

interface KiteWindowBridgePoint {
  screenX: number
  screenY: number
}

interface KiteWindowBridge {
  startDrag: (point: KiteWindowBridgePoint) => void
  dragTo: (point: KiteWindowBridgePoint) => void
  endDrag: () => void
  toggleMaximize: () => Promise<void>
  desktopToken?: string
}

interface Window {
  kiteWindow?: KiteWindowBridge
}
